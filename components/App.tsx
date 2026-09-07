"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import Call from "./Call";

type CallState = {
  room: string;
  video: boolean;
  initiator: boolean;
};

type IncomingCall = {
  id: string;
  caller_id: string;
  caller_name: string;
  room_id: string;
  video: boolean;
};

export default function App() {
  const sb = useRef(getSupabase()).current;

  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [ai, setAi] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [call, setCall] = useState<CallState | null>(null);
  const [incomingCall, setIncomingCall] =
    useState<IncomingCall | null>(null);
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(0);
  const [sending, setSending] = useState(false);
  const [callingMember, setCallingMember] =
    useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    sb.auth.getUser().then(({ data }) => {
      if (mounted) {
        setUser(data.user);
      }
    });

    const auth = sb.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) {
          setUser(session?.user ?? null);
        }
      }
    );

    const msg = sb
      .channel("gosnaps-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          setMessages((old) => {
            const exists = old.some(
              (m) => m.id === payload.new.id
            );

            return exists
              ? old
              : [...old, payload.new];
          });
        }
      )
      .subscribe();

    sb.from("messages")
      .select("*")
      .order("created_at", {
        ascending: true,
      })
      .limit(100)
      .then(({ data }) => {
        if (mounted && data) {
          setMessages(data);
        }
      });

    const presence = sb.channel(
      "gosnaps-presence",
      {
        config: {
          presence: {
            key: Math.random()
              .toString(36),
          },
        },
      }
    );

    presence
      .on(
        "presence",
        { event: "sync" },
        () => {
          setOnline(
            Object.keys(
              presence.presenceState()
            ).length
          );
        }
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presence.track({
            online_at:
              new Date().toISOString(),
          });
        }
      });

    const calls = sb
      .channel("gosnaps-call-invitations")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_invitations",
        },
        async (payload) => {
          if (!mounted) return;

          const invitation = payload.new as any;

          if (
            !user ||
            invitation.receiver_id !== user.id
          ) {
            return;
          }

          if (
            invitation.status !== "ringing"
          ) {
            return;
          }

          let callerName =
            "Academic Hunters member";

          const { data: profile } =
            await sb
              .from("profiles")
              .select("display_name")
              .eq(
                "id",
                invitation.caller_id
              )
              .maybeSingle();

          if (profile?.display_name) {
            callerName =
              profile.display_name;
          }

          setIncomingCall({
            id: invitation.id,
            caller_id:
              invitation.caller_id,
            caller_name:
              callerName,
            room_id:
              invitation.room_id,
            video:
              invitation.video,
          });

          setToast(
            invitation.video
              ? "Incoming video call"
              : "Incoming voice call"
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_invitations",
        },
        (payload) => {
          if (!mounted || !user) {
            return;
          }

          const invitation =
            payload.new as any;

          if (
            invitation.caller_id !==
            user.id
          ) {
            return;
          }

          if (
            invitation.status ===
            "accepted"
          ) {
            setCallingMember(null);

            setCall({
              room:
                invitation.room_id,
              video:
                invitation.video,
              initiator: true,
            });

            setToast(
              "Call accepted. Connecting..."
            );
          }

          if (
            invitation.status ===
            "rejected"
          ) {
            setCallingMember(null);

            setToast(
              "The member declined the call."
            );
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;

      auth.data.subscription.unsubscribe();

      sb.removeChannel(msg);
      sb.removeChannel(presence);
      sb.removeChannel(calls);
    };
  }, [sb, user]);

  async function login() {
    if (!email.trim()) {
      setToast("Enter your email.");
      return;
    }

    const { error } =
      await sb.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo:
            "https://gosnaps.com",
        },
      });

    setToast(
      error?.message ||
        "Check your email for the sign-in link."
    );
  }

  async function loadMembers() {
    setToast("Loading members...");

    const { data, error } = await sb
      .from("profiles")
      .select(
        "id,display_name,created_at"
      )
      .limit(50);

    if (error) {
      setToast(error.message);
      return;
    }

    if (data) {
      setMembers(data);
      setToast(
        `${data.length} member(s) found`
      );
    }
  }

  async function startMemberCall(
    member: any,
    video: boolean
  ) {
    if (!user) {
      setToast(
        "Sign in before calling."
      );
      return;
    }

    if (!member?.id) {
      setToast(
        "Member information is missing."
      );
      return;
    }

    if (member.id === user.id) {
      setToast(
        "You cannot call yourself."
      );
      return;
    }

    if (callingMember) {
      setToast(
        "A call is already being started."
      );
      return;
    }

    setCallingMember(member.id);

    const room =
      crypto.randomUUID();

    const { error } =
      await sb
        .from("call_invitations")
        .insert({
          caller_id: user.id,
          receiver_id: member.id,
          room_id: room,
          video,
          status: "ringing",
        });

    if (error) {
      setCallingMember(null);
      setToast(error.message);
      return;
    }

    setToast(
      video
        ? `Calling ${member.display_name || "member"}...`
        : `Calling ${member.display_name || "member"}...`
    );
  }

  async function acceptCall() {
    if (!incomingCall) {
      return;
    }

    const accepted =
      incomingCall;

    const { error } =
      await sb
        .from("call_invitations")
        .update({
          status: "accepted",
        })
        .eq("id", accepted.id);

    if (error) {
      setToast(error.message);
      return;
    }

    setIncomingCall(null);

    setCall({
      room:
        accepted.room_id,
      video:
        accepted.video,
      initiator: false,
    });

    setToast(
      "Call accepted. Connecting..."
    );
  }

  async function rejectCall() {
    if (!incomingCall) {
      return;
    }

    const id =
      incomingCall.id;

    const { error } =
      await sb
        .from("call_invitations")
        .update({
          status: "rejected",
        })
        .eq("id", id);

    if (error) {
      setToast(error.message);
      return;
    }

    setIncomingCall(null);

    setToast(
      "Call declined."
    );
  }

  async function openFile(path: string) {
    if (!user) {
      setToast("Sign in first.");
      return;
    }

    if (!path) {
      setToast("File path is missing.");
      return;
    }

    setToast("Preparing file...");

    const { data, error } =
      await sb.storage
        .from("gosnaps-files")
        .createSignedUrl(
          path,
          3600
        );

    if (
      error ||
      !data?.signedUrl
    ) {
      setToast(
        error?.message ||
          "Could not open this file."
      );
      return;
    }

    window.open(
      data.signedUrl,
      "_blank",
      "noopener,noreferrer"
    );

    setToast("File opened.");
  }

  async function downloadFile(
    path: string,
    name: string
  ) {
    if (!user) {
      setToast("Sign in first.");
      return;
    }

    if (!path) {
      setToast("File path is missing.");
      return;
    }

    setToast("Preparing download...");

    const { data, error } =
      await sb.storage
        .from("gosnaps-files")
        .createSignedUrl(
          path,
          3600,
          {
            download:
              name || true,
          }
        );

    if (
      error ||
      !data?.signedUrl
    ) {
      setToast(
        error?.message ||
          "Could not download this file."
      );
      return;
    }

    const link =
      document.createElement("a");

    link.href =
      data.signedUrl;

    link.download =
      name ||
      "Academic-Hunters-file";

    link.target = "_blank";

    document.body.appendChild(link);

    link.click();

    link.remove();

    setToast(
      "Download started."
    );
  }

  async function send() {
    if (sending) return;

    if (ai) {
      const q = text.trim();

      if (!q) return;

      setSending(true);
      setText("");

      try {
        const r = await fetch(
          "/api/chat",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              message: q,
            }),
          }
        );

        const d = await r.json();

        setMessages((old) => [
          ...old,
          {
            id: Date.now(),
            sender:
              "Academic Hunters AI",
            text:
              d.reply ||
              d.error ||
              "AI could not respond.",
            created_at:
              new Date().toISOString(),
          },
        ]);
      } catch {
        setToast(
          "AI connection failed."
        );
      } finally {
        setSending(false);
      }

      return;
    }

    if (!user) {
      setToast("Sign in first.");
      return;
    }

    const messageText =
      text.trim();

    if (
      !messageText &&
      !file
    ) {
      setToast(
        "Type a message or choose a file."
      );
      return;
    }

    setSending(true);

    try {
      let attachmentPath:
        | string
        | null = null;

      let attachmentName:
        | string
        | null = null;

      if (file) {
        const path =
          `${user.id}/${Date.now()}-${file.name}`;

        const upload =
          await sb.storage
            .from("gosnaps-files")
            .upload(
              path,
              file
            );

        if (upload.error) {
          setToast(
            upload.error.message
          );
          return;
        }

        attachmentPath = path;
        attachmentName =
          file.name;
      }

      const message = {
        sender_id: user.id,

        receiver_id: null,

        sender:
          user.email ||
          "Academic Hunters Member",

        content:
          messageText ||
          "📎 File",

        text:
          messageText ||
          "📎 File",

        file_url:
          attachmentPath,

        attachment:
          attachmentPath
            ? {
                path:
                  attachmentPath,
                name:
                  attachmentName ||
                  "File",
              }
            : null,
      };

      const result =
        await sb
          .from("messages")
          .insert(message);

      if (result.error) {
        setToast(
          result.error.message
        );
        return;
      }

      setToast("Sent");
      setText("");
      setFile(null);
    } catch (error: any) {
      setToast(
        error?.message ||
          "Something went wrong."
      );
    } finally {
      setSending(false);
    }
  }

  function closeCall() {
    setCall(null);
    setCallingMember(null);
    setToast("Call ended.");
  }

  return (
    <main className="wrap">
      <header>
        <div className="logo">
          ACADEMIC{" "}
          <span>HUNTERS</span>
        </div>

        <div className="live">
          ● {online} online
        </div>
      </header>

      <section className="hero">
        <small>
          CONNECT • CHAT • CALL • CREATE
        </small>

        <h1>
          Welcome to Academic Hunters.
        </h1>

        <p>
          Real-time conversations,
          AI, files and browser
          voice/video calling.
        </p>
      </section>

      {!user ? (
        <section className="login">
          <input
            value={email}
            onChange={(e) =>
              setEmail(
                e.target.value
              )
            }
            placeholder="Email address"
            type="email"
          />

          <button
            onClick={login}
            disabled={sending}
          >
            Sign in
          </button>
        </section>
      ) : (
        <div className="welcome">
          Signed in as{" "}
          <b>{user.email}</b>
        </div>
      )}

      <nav>
        <button
          className={
            !ai
              ? "active"
              : ""
          }
          onClick={() =>
            setAi(false)
          }
        >
          💬 Messages
        </button>

        <button
          className={
            ai
              ? "active"
              : ""
          }
          onClick={() =>
            setAi(true)
          }
        >
          ✨ Academic Hunters AI
        </button>

        <button
          onClick={() => {
            if (!user) {
              setToast(
                "Sign in before calling."
              );
              return;
            }

            setToast(
              "Open Members and choose a member to call."
            );

            loadMembers();
          }}
        >
          📞 Voice
        </button>

        <button
          onClick={() => {
            if (!user) {
              setToast(
                "Sign in before calling."
              );
              return;
            }

            setToast(
              "Open Members and choose a member to call."
            );

            loadMembers();
          }}
        >
          🎥 Video
        </button>

        <button
          onClick={loadMembers}
        >
          👥 Members
        </button>
      </nav>

      {toast && (
        <div
          className="toast"
          onClick={() =>
            setToast("")
          }
        >
          {toast}
        </div>
      )}

      {incomingCall && (
        <div className="incoming-call">
          <h3>
            {incomingCall.video
              ? "🎥 Incoming video call"
              : "📞 Incoming voice call"}
          </h3>

          <p>
            <b>
              {incomingCall.caller_name}
            </b>{" "}
            is calling you.
          </p>

          <div
            style={{
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={acceptCall}
            >
              ✅ Accept
            </button>

            <button
              type="button"
              onClick={rejectCall}
            >
              ❌ Decline
            </button>
          </div>
        </div>
      )}

      {members.length > 0 && (
        <aside className="members">
          <h3>
            Academic Hunters Members
          </h3>

          {members
            .filter(
              (m) =>
                !user ||
                m.id !== user.id
            )
            .map((m) => (
              <div
                key={m.id}
                style={{
                  padding:
                    "10px",
                  marginBottom:
                    "8px",
                  borderRadius:
                    "10px",
                  background:
                    "rgba(255,255,255,.08)",
                }}
              >
                <div>
                  🟢{" "}
                  {m.display_name ||
                    "Academic Hunters member"}
                </div>

                <div
                  style={{
                    display:
                      "flex",
                    gap: "8px",
                    marginTop:
                      "8px",
                    flexWrap:
                      "wrap",
                  }}
                >
                  <button
                    type="button"
                    disabled={
                      callingMember ===
                      m.id
                    }
                    onClick={() =>
                      startMemberCall(
                        m,
                        false
                      )
                    }
                  >
                    {callingMember ===
                    m.id
                      ? "Calling..."
                      : "📞 Voice"}
                  </button>

                  <button
                    type="button"
                    disabled={
                      callingMember ===
                      m.id
                    }
                    onClick={() =>
                      startMemberCall(
                        m,
                        true
                      )
                    }
                  >
                    🎥 Video
                  </button>
                </div>
              </div>
            ))}
        </aside>
      )}

      <section className="chat">
        {messages.map(
          (m, i) => {
            const attachment =
              m.attachment;

            const attachmentPath =
              typeof attachment ===
              "object"
                ? attachment?.path
                : attachment;

            const attachmentName =
              typeof attachment ===
              "object"
                ? attachment?.name
                : "Open file";

            return (
              <article
                className={
                  m.sender ===
                  "Academic Hunters AI"
                    ? "msg ai"
                    : "msg"
                }
                key={
                  m.id ?? i
                }
              >
                <b>
                  {m.sender ||
                    "Member"}
                </b>

                <p>
                  {m.text ||
                    m.content ||
                    ""}
                </p>

                {attachmentPath && (
                  <div
                    style={{
                      display:
                        "flex",
                      gap: "8px",
                      flexWrap:
                        "wrap",
                      marginTop:
                        "8px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        openFile(
                          attachmentPath
                        )
                      }
                    >
                      📂 Open{" "}
                      {
                        attachmentName
                      }
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadFile(
                          attachmentPath,
                          attachmentName
                        )
                      }
                    >
                      ⬇️ Download
                    </button>
                  </div>
                )}
              </article>
            );
          }
        )}
      </section>

      <div className="composer">
        <label>
          📎

          <input
            type="file"
            onChange={(e) =>
              setFile(
                e.target.files?.[0] ||
                  null
              )
            }
          />
        </label>

        <input
          value={text}
          onChange={(e) =>
            setText(
              e.target.value
            )
          }
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !sending
            ) {
              send();
            }
          }}
          placeholder={
            ai
              ? "Ask Academic Hunters AI…"
              : "Message Academic Hunters…"
          }
        />

        <button
          onClick={send}
          disabled={sending}
        >
          {sending
            ? "Sending..."
            : "Send"}
        </button>
      </div>

      {call && (
        <Call
          room={call.room}
          video={call.video}
          initiator={
            call.initiator
          }
          onClose={
            closeCall
          }
        />
      )}
    </main>
  );
}
