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

    async function loadUser() {
      const { data } = await sb.auth.getUser();

      if (mounted) {
        setUser(data.user || null);
      }
    }

    loadUser();

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
          setMessages((current) => {
            const exists = current.some((m) => m.id === payload.new.id);
            if (exists) return current;

            return [...current, payload.new];
          });
        }
      )
      .subscribe();

    sb.from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data, error }) => {
        if (error) {
          setToast(error.message);
          return;
        }

        if (data && mounted) {
          setMessages(data);
        }
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
        setOnline(Object.keys(presence.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presence.track({
            online_at: new Date().toISOString(),
          });
        }
      });

    const {
      data: authListener,
    } = sb.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user || null);
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      sb.removeChannel(msg);
      sb.removeChannel(presence);
    };
  }, [sb]);

  async function login() {
    if (!email.trim()) {
      setToast("Enter your email address.");
      return;
    }

    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
    });

    setToast(
      error?.message ||
        "Check your email for the GOSNAPS sign-in link."
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

    if (data) {
      setMembers(data);
    }
  }

  async function send() {
    if (sending) return;

    if (ai) {
      const q = text.trim();

      if (!q) return;

      setSending(true);
      setText("");

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: q,
          }),
        });

        const data = await response.json();

        setMessages((current) => [
          ...current,
          {
            id: `ai-${Date.now()}`,
            sender: "GOSNAPS AI",
            text: data.reply || data.error || "AI could not respond.",
            created_at: new Date().toISOString(),
          },
        ]);
      } catch (error: any) {
        setMessages((current) => [
          ...current,
          {
            id: `ai-error-${Date.now()}`,
            sender: "GOSNAPS AI",
            text: error?.message || "Unable to contact GOSNAPS AI.",
            created_at: new Date().toISOString(),
          },
        ]);
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
      return;
    }

    setSending(true);

    let attachment = null;

    try {
      if (file) {
        const path = `${user.id}/${Date.now()}-${file.name}`;

        const upload = await sb.storage
          .from("gosnaps-files")
          .upload(path, file);

        if (upload.error) {
          setToast(upload.error.message);
          return;
        }

        attachment = path;
      }

      const message = {
        id: crypto.randomUUID(),
        sender_id: user.id,
        receiver_id: null,
        sender: user.email || "Member",
        content: messageText || "📎 File",
        text: messageText || "📎 File",
        file_url: attachment,
        attachment: attachment
          ? {
              path: attachment,
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
      setToast(error?.message || "Unable to send message.");
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
        <small>CONNECT • CHAT • CALL • CREATE</small>

        <h1>One place for your people.</h1>

        <p>
          Real-time conversations, AI, files and
          browser voice/video calling.
        </p>
      </section>

      {!user ? (
        <section className="login">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            type="email"
            onKeyDown={(e) => {
              if (e.key === "Enter") login();
            }}
          />

          <button onClick={login}>
            Sign in
          </button>
        </section>
      ) : (
        <div className="welcome">
          Signed in as <b>{user.email}</b>
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

        <button onClick={() => startCall(false)}>
          📞 Voice
        </button>

        <button onClick={() => startCall(true)}>
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
          {members.map((member) => (
            <div key={member.id}>
              🟢{" "}
              {member.display_name ||
                "GOSNAPS member"}
            </div>
          ))}
        </aside>
      )}

      <section className="chat">
        {messages.map((message, index) => (
          <article
            className={
              message.sender === "GOSNAPS AI"
                ? "msg ai"
                : "msg"
            }
            key={message.id ?? index}
          >
            <b>
              {message.sender ||
                message.sender_id ||
                "Member"}
            </b>

            <p>
              {message.text ||
                message.content ||
                ""}
            </p>

            {message.attachment && (
              <small>
                📎{" "}
                {typeof message.attachment ===
                "string"
                  ? message.attachment
                  : message.attachment.name ||
                    message.attachment.path ||
                    "Attachment"}
              </small>
            )}

            {!message.attachment &&
              message.file_url && (
                <small>
                  📎 {message.file_url}
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
              setFile(
                e.target.files?.[0] || null
              )
            }
          />
        </label>

        <input
          value={text}
          onChange={(e) =>
            setText(e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !sending) {
              send();
            }
          }}
          placeholder={
            ai
              ? "Ask GOSNAPS AI…"
              : "Message GOSNAPS…"
          }
        />

        <button
          onClick={send}
          disabled={sending}
        >
          {sending ? "Sending…" : "Send"}
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
