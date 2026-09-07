"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import Call from "./Call";

export default function App() {
  const sb = useRef(getSupabase()).current;

  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [ai, setAi] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [call, setCall] = useState<any>(null);
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let mounted = true;

    sb.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user);
    });

    const auth = sb.auth.onAuthStateChange((_event, session) => {
      if (mounted) setUser(session?.user ?? null);
    });

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
            const exists = old.some((m) => m.id === payload.new.id);
            return exists ? old : [...old, payload.new];
          });
        }
      )
      .subscribe();

    sb.from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (mounted && data) setMessages(data);
      });

    const presence = sb.channel("gosnaps-presence", {
      config: {
        presence: {
          key: Math.random().toString(36),
        },
      },
    });

    presence
      .on("presence", { event: "sync" }, () => {
        setOnline(
          Object.keys(presence.presenceState()).length
        );
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presence.track({
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      mounted = false;
      auth.data.subscription.unsubscribe();
      sb.removeChannel(msg);
      sb.removeChannel(presence);
    };
  }, [sb]);

  async function login() {
    if (!email.trim()) {
      setToast("Enter your email.");
      return;
    }

    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: "https://gosnapscom.vercel.app",
      },
    });

    setToast(
      error?.message ||
        "Check your email for the sign-in link."
    );
  }

  async function loadMembers() {
    const { data, error } = await sb
      .from("profiles")
      .select("id,display_name,created_at")
      .limit(50);

    if (error) {
      setToast(error.message);
      return;
    }

    if (data) setMembers(data);
  }

  async function send() {
    if (sending) return;

    if (ai) {
      const q = text.trim();

      if (!q) return;

      setSending(true);
      setText("");

      try {
        const r = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: q,
          }),
        });

        const d = await r.json();

        setMessages((old) => [
          ...old,
          {
            id: Date.now(),
            sender: "GOSNAPS AI",
            text:
              d.reply ||
              d.error ||
              "AI could not respond.",
            created_at: new Date().toISOString(),
          },
        ]);
      } catch {
        setToast("AI connection failed.");
      } finally {
        setSending(false);
      }

      return;
    }

    if (!user) {
      setToast("Sign in first.");
      return;
    }

    const messageText = text.trim();

    if (!messageText && !file) {
      setToast("Type a message or choose a file.");
      return;
    }

    setSending(true);

    try {
      let attachmentPath: string | null = null;

      if (file) {
        const path =
          `${user.id}/${Date.now()}-${file.name}`;

        const upload = await sb.storage
          .from("gosnaps-files")
          .upload(path, file);

        if (upload.error) {
          setToast(upload.error.message);
          return;
        }

        attachmentPath = path;
      }

      /*
       * IMPORTANT:
       * Do NOT provide "id" here.
       *
       * messages.id is BIGINT, so PostgreSQL
       * should generate it automatically.
       */
      const message = {
        sender_id: user.id,
        receiver_id: null,
        sender: user.email || "Member",
        content: messageText || "📎 File",
        text: messageText || "📎 File",
        file_url: attachmentPath,
        attachment: attachmentPath
          ? {
              path: attachmentPath,
              name: file?.name || "File",
            }
          : null,
      };

      const result = await sb
        .from("messages")
        .insert(message);

      if (result.error) {
        setToast(result.error.message);
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

  function startCall(video: boolean) {
    if (!user) {
      setToast("Sign in before calling.");
      return;
    }

    setCall({
      room: crypto.randomUUID(),
      video,
      initiator: true,
    });
  }

  return (
    <main className="wrap">
      <header>
        <div className="logo">
          GO<span>SNAPS</span>
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
          One place for your people.
        </h1>

        <p>
          Real-time conversations, AI, files
          and browser voice/video calling.
        </p>
      </section>

      {!user ? (
        <section className="login">
          <input
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
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
          className={!ai ? "active" : ""}
          onClick={() => setAi(false)}
        >
          💬 Messages
        </button>

        <button
          className={ai ? "active" : ""}
          onClick={() => setAi(true)}
        >
          ✨ AI
        </button>

        <button
          onClick={() => startCall(false)}
        >
          📞 Voice
        </button>

        <button
          onClick={() => startCall(true)}
        >
          🎥 Video
        </button>

        <button onClick={loadMembers}>
          👥 Members
        </button>
      </nav>

      {toast && (
        <div
          className="toast"
          onClick={() => setToast("")}
        >
          {toast}
        </div>
      )}

            {members.length > 0 && (
        <aside className="members">
          {members.map((m) => (
            <div key={m.id}>
              🟢 {m.display_name || "GOSNAPS member"}
            </div>
          ))}
        </aside>
      )}

      <section className="chat">
        {messages.map((m, i) => (
          <article
            className={
              m.sender === "GOSNAPS AI" ? "msg ai" : "msg"
            }
            key={m.id ?? i}
          >
            <b>{m.sender || "Member"}</b>
            <p>{m.text || m.content || ""}</p>

            {m.attachment && (
              <small>
                📎{" "}
                {typeof m.attachment === "object"
                  ? m.attachment.name
                  : m.attachment}
              </small>
            )}
          </article>
        ))}
      </section>

      <div className="composer">
        <label>
          📎
          <input
            type="file"
            onChange={(e) =>
              setFile(e.target.files?.[0] || null)
            }
          />
        </label>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !sending) send();
          }}
          placeholder={
            ai ? "Ask GOSNAPS AI…" : "Message GOSNAPS…"
          }
        />

        <button onClick={send} disabled={sending}>
          {sending ? "Sending..." : "Send"}
        </button>
      </div>

      {call && (
        <Call
          room={call.room}
          video={call.video}
          onClose={() => setCall(null)}
        />
      )}
    </main>
  );
          }
