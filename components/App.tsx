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

type PrivateMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
};

export default function App() {
  const sb = useRef(getSupabase()).current;

  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [privateMessages, setPrivateMessages] =
    useState<PrivateMessage[]>([]);
  const [text, setText] = useState("");
  const [privateText, setPrivateText] = useState("");
  const [ai, setAi] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [call, setCall] =
    useState<CallState | null>(null);

  const [incomingCall, setIncomingCall] =
    useState<IncomingCall | null>(null);

  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(0);
  const [sending, setSending] = useState(false);
  const [callingMember, setCallingMember] =
    useState<string | null>(null);

  const [selectedMember, setSelectedMember] =
    useState<any | null>(null);

  const [conversationId, setConversationId] =
    useState<string | null>(null);

  const [privateLoading, setPrivateLoading] =
    useState(false);

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
            key: Math.random().toString(36),
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
      .limit(100);

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

  async function openPrivateChat(
    member: any
  ) {
    if (!user) {
      setToast("Sign in first.");
      return;
    }

    if (!member?.id) {
      setToast("Member information is missing.");
      return;
    }

    if (member.id === user.id) {
      setToast("You cannot message yourself.");
      return;
    }

    setPrivateLoading(true);
    setToast("Opening private chat...");

    try {
      const ids = [user.id, member.id].sort();

      const stableConversationId =
        await makeConversationId(
          ids[0],
          ids[1]
        );

      const conversationInsert =
        await sb
          .from("conversations")
          .insert({
            id: stableConversationId,
          });

      if (
        conversationInsert.error &&
        !conversationInsert.error.message
          .toLowerCase()
          .includes("duplicate")
      ) {
        setToast(
          conversationInsert.error.message
        );
        return;
      }

      const membersInsert =
        await sb
          .from("conversation_members")
          .upsert(
            [
              {
                conversation_id:
                  stableConversationId,
                user_id: user.id,
              },
              {
                conversation_id:
                  stableConversationId,
                user_id: member.id,
              },
            ],
            {
              onConflict:
                "conversation_id,user_id",
            }
          );

      if (membersInsert.error) {
        setToast(
          membersInsert.error.message
        );
        return;
      }

      setSelectedMember(member);
      setConversationId(
        stableConversationId
      );

      await loadPrivateMessages(
        stableConversationId
      );

      setToast(
        `Private chat with ${
          member.display_name ||
          "member"
        } opened`
      );
    } finally {
      setPrivateLoading(false);
    }
  }

  async function makeConversationId(
    first: string,
    second: string
  ) {
    const value =
      `academic-hunters:${first}:${second}`;

    const encoder =
      new TextEncoder();

    const bytes =
      encoder.encode(value);

    const hash =
      await crypto.subtle.digest(
        "SHA-256",
        bytes
      );

    const hashArray =
      Array.from(
        new Uint8Array(hash)
      );

    const hex =
      hashArray
        .map((b) =>
          b.toString(16).padStart(2, "0")
        )
        .join("");

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }

  async function loadPrivateMessages(
    id: string
  ) {
    setPrivateLoading(true);

    const { data, error } =
      await sb
        .from("private_messages")
        .select(
          "id,conversation_id,sender_id,content,created_at,read_at"
        )
        .eq(
          "conversation_id",
          id
        )
        .order("created_at", {
          ascending: true,
        })
        .limit(200);

    if (error) {
      setToast(error.message);
      setPrivateLoading(false);
      return;
    }

    setPrivateMessages(
      data || []
    );

    setPrivateLoading(false);

    if (user) {
      await sb
        .from("private_messages")
        .update({
          read_at:
            new Date().toISOString(),
        })
        .eq(
          "conversation_id",
          id
        )
        .neq(
          "sender_id",
          user.id
        )
        .is("read_at", null);
    }
  }

  async function sendPrivateMessage() {
    if (!user) {
      setToast("Sign in first.");
      return;
    }

    if (!conversationId) {
      setToast("Open a private chat first.");
      return;
    }

    const value =
      privateText.trim();

    if (!value) {
      return;
    }

    setSending(true);

    const { error } =
      await sb
        .from("private_messages")
        .insert({
          conversation_id:
            conversationId,
          sender_id:
            user.id,
          content:
            value,
        });

    if (error) {
      setToast(error.message);
      setSending(false);
      return;
    }

    setPrivateText("");
    setSending(false);
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
      `Calling ${
        member.display_name ||
        "member"
      }...`
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
        .eq(
          "id",
          accepted.id
        );

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

  async function openFile(
    path: string
  ) {
    if (!user) {
      setToast("Sign in first.");
      return;
    }

    if (!path) {
      setToast(
        "File path is missing."
      );
      return;
    }

    setToast(
      "Preparing file..."
    );

    const { data, error } =
      await sb.storage
        .from(
          "gosnaps-files"
        )
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

    setToast(
      "File opened."
    );
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
      setToast(
        "File path is missing."
      );
      return;
    }

    setToast(
      "Preparing download..."
    );

    const { data, error } =
      await sb.storage
        .from(
          "gosnaps-files"
        )
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
      document.createElement(
        "a"
      );

    link.href =
      data.signedUrl;

    link.download =
      name ||
      "Academic-Hunters-file";

    link.target =
      "_blank";

    document.body.appendChild(
      link
    );

    link.click();

    link.remove();

    setToast(
      "Download started."
    );
  }

  async function send() {
    if (sending) return;

    if (ai) {
      const q =
        text.trim();

      if (!q) return;

      setSending(true);
      setText("");

      try {
        const r =
          await fetch(
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

        const d =
          await r.json();

        setMessages(
          (old) => [
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
          ]
        );
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
      setToast(
        "Sign in first."
      );
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
            .from(
              "gosnaps-files"
            )
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

        attachmentPath =
          path;

        attachmentName =
          file.name;
      }

      const message = {
        sender_id:
          user.id,

        receiver_id:
          null,

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
          .insert(
            message
          );

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

  function closePrivateChat() {
    setSelectedMember(null);
    setConversationId(null);
    setPrivateMessages([]);
    setPrivateText("");
  }

  function closeCall() {
    setCall(null);
    setCallingMember(null);
    setToast(
      "Call ended."
    );
  }

  const filteredMembers =
    members.filter((m) => {
      if (!user || m.id === user.id) {
        return false;
      }

      const name =
        (
          m.display_name ||
          "Academic Hunters member"
        ).toLowerCase();

      return name.includes(
        memberSearch.trim().toLowerCase()
      );
    });

  return (
    <main className="wrap">
      <header>
        <div className="logo">
          ACADEMIC{" "}
          <span>
            HUNTERS
          </span>
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
          <b>
            {user.email}
          </b>
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

            loadMembers();
            setToast(
              "Choose a member to call."
            );
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

            loadMembers();
            setToast(
              "Choose a member to call."
            );
          }}
        >
          🎥 Video
        </button>

        <button
          onClick={
            loadMembers
          }
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
              {
                incomingCall.caller_name
              }
            </b>{" "}
            is calling you.
          </p>

          <div
            style={{
              display:
                "flex",
              gap: "10px",
              flexWrap:
                "wrap",
            }}
          >
            <button
              type="button"
              onClick={
                acceptCall
              }
            >
              ✅ Accept
            </button>

            <button
              type="button"
              onClick={
                rejectCall
              }
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

          <input
            type="search"
            value={memberSearch}
            onChange={(e) =>
              setMemberSearch(
                e.target.value
              )
            }
            placeholder="🔎 Search members..."
            style={{
              width: "100%",
              padding: "11px 13px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,.18)",
              outline: "none",
              marginBottom: "12px",
              boxSizing: "border-box",
            }}
          />

          {filteredMembers.length === 0 ? (
            <div
              style={{
                padding: "14px",
                borderRadius: "12px",
                background:
                  "rgba(255,255,255,.08)",
              }}
            >
              {memberSearch.trim()
                ? "No members found."
                : "No other members available."}
            </div>
          ) : (
            filteredMembers.map((m) => (
              <div
                key={m.id}
                style={{
                  padding:
                    "12px",
                  marginBottom:
                    "10px",
                  borderRadius:
                    "12px",
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
                    gap:
                      "8px",
                    marginTop:
                      "9px",
                    flexWrap:
                      "wrap",
                  }}
                >
                  <button
                    type="button"
                    disabled={
                      privateLoading
                    }
                    onClick={() =>
                      openPrivateChat(
                        m
                      )
                    }
                  >
                    💬 Chat
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
            ))
          )}
        </aside>
      )}

      {selectedMember &&
        conversationId && (
          <section
            className="private-chat"
            style={{
              marginTop:
                "15px",
              padding:
                "14px",
              borderRadius:
                "14px",
              background:
                "rgba(255,255,255,.08)",
            }}
          >
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap: "10px",
                marginBottom:
                  "12px",
              }}
            >
              <div>
                <b>
                  💬 Private chat
                </b>

                <div>
                  {
                    selectedMember.display_name ||
                    "Academic Hunters member"
                  }
                </div>
              </div>

              <button
                type="button"
                onClick={
                  closePrivateChat
                }
              >
                ✕
              </button>
            </div>

            <div
              style={{
                maxHeight:
                  "320px",
                overflowY:
                  "auto",
                padding:
                  "5px",
              }}
            >
              {privateLoading ? (
                <p>
                  Loading private messages...
                </p>
              ) : privateMessages.length ===
                0 ? (
                <p>
                  No private messages yet.
                  Start the conversation.
                </p>
              ) : (
                privateMessages.map(
                  (m) => (
                    <article
                      key={
                        m.id
                      }
                      style={{
                        padding:
                          "9px 11px",
                        marginBottom:
                          "8px",
                        borderRadius:
                          "10px",
                        background:
                          m.sender_id ===
                          user?.id
                            ? "rgba(0,128,105,.25)"
                            : "rgba(255,255,255,.10)",
                      }}
                    >
                      <b>
                        {m.sender_id ===
                        user?.id
                          ? "You"
                          : selectedMember.display_name ||
                            "Member"}
                      </b>

                      <p>
                        {
                          m.content
                        }
                      </p>

                      <small>
                        {new Date(
                          m.created_at
                        ).toLocaleString()}
                        {m.sender_id ===
                          user?.id &&
                          m.read_at
                          ? " • ✓ Read"
                          : ""}
                      </small>
                    </article>
                  )
                )
              )}
            </div>

            <div
              style={{
                display:
                  "flex",
                gap:
                  "8px",
                marginTop:
                  "10px",
              }}
            >
              <input
                value={
                  privateText
                }
                onChange={(
                  e
                ) =>
                  setPrivateText(
                    e.target
                      .value
                  )
                }
                onKeyDown={(
                  e
                ) => {
                  if (
                    e.key ===
                      "Enter" &&
                    !sending
                  ) {
                    sendPrivateMessage();
                  }
                }}
                placeholder="Write a private message..."
                style={{
                  flex: 1,
                }}
              />

              <button
                type="button"
                onClick={
                  sendPrivateMessage
                }
                disabled={
                  sending
                }
              >
                {sending
                  ? "..."
                  : "Send"}
              </button>
            </div>
          </section>
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
                      gap:
                        "8px",
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
                e.target
                  .files?.[0] ||
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
              e.key ===
                "Enter" &&
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
          disabled={
            sending
          }
        >
          {sending
            ? "Sending..."
            : "Send"}
        </button>
      </div>

      {call && (
        <Call
          room={
            call.room
          }
          video={
            call.video
          }
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
