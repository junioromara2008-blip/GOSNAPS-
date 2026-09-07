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
  file_path?: string | null;
  file_name?: string | null;
};

type Member = {
  id: string;
  display_name?: string | null;
  avatar_path?: string | null;
  created_at?: string;
  avatar_url?: string | null;
};

export default function App() {
  const sb = useRef(getSupabase()).current;

  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");

  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearch, setMemberSearch] = useState("");

  const [messages, setMessages] = useState<any[]>([]);
  const [privateMessages, setPrivateMessages] =
    useState<PrivateMessage[]>([]);

  const [text, setText] = useState("");
  const [privateText, setPrivateText] = useState("");

  const [ai, setAi] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [privateFile, setPrivateFile] =
    useState<File | null>(null);

  const [call, setCall] =
    useState<CallState | null>(null);

  const [incomingCall, setIncomingCall] =
    useState<IncomingCall | null>(null);

  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(0);

  const [onlineUsers, setOnlineUsers] =
    useState<Record<string, boolean>>({});

  const [sending, setSending] = useState(false);
  const [callingMember, setCallingMember] =
    useState<string | null>(null);

  const [selectedMember, setSelectedMember] =
    useState<Member | null>(null);

  const [conversationId, setConversationId] =
    useState<string | null>(null);

  const [privateLoading, setPrivateLoading] =
    useState(false);

  const [myProfile, setMyProfile] =
    useState<Member | null>(null);

  const [displayName, setDisplayName] =
    useState("");

  const [profileFile, setProfileFile] =
    useState<File | null>(null);

  const [savingProfile, setSavingProfile] =
    useState(false);

  /*
   * AUTH
   */
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

    return () => {
      mounted = false;
      auth.data.subscription.unsubscribe();
    };
  }, [sb]);

  /*
   * PUBLIC CHAT + PRESENCE + CALLS
   */
  useEffect(() => {
    if (!user) {
      setOnline(0);
      setOnlineUsers({});
      return;
    }

    let mounted = true;

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

    /*
     * REALTIME PRESENCE
     */
    const presence = sb.channel(
      "gosnaps-presence",
      {
        config: {
          presence: {
            key: user.id,
          },
        },
      }
    );

    const updatePresence = () => {
      const state =
        presence.presenceState();

      const users: Record<
        string,
        boolean
      > = {};

      Object.keys(state).forEach(
        (key) => {
          users[key] = true;
        }
      );

      setOnlineUsers(users);
      setOnline(
        Object.keys(users).length
      );
    };

    presence
      .on(
        "presence",
        { event: "sync" },
        updatePresence
      )
      .on(
        "presence",
        { event: "join" },
        updatePresence
      )
      .on(
        "presence",
        { event: "leave" },
        updatePresence
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presence.track({
            user_id: user.id,
            online_at:
              new Date().toISOString(),
          });

          updatePresence();
        }
      });

    /*
     * CALL INVITATIONS
     */
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

          const invitation =
            payload.new as any;

          if (
            invitation.receiver_id !==
            user.id
          ) {
            return;
          }

          if (
            invitation.status !==
            "ringing"
          ) {
            return;
          }

          let callerName =
            "Academic Hunters member";

          const { data: profile } =
            await sb
              .from("profiles")
              .select(
                "display_name"
              )
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
          if (!mounted) return;

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

      sb.removeChannel(msg);
      sb.removeChannel(presence);
      sb.removeChannel(calls);
    };
  }, [sb, user]);

  /*
   * LOAD OWN PROFILE
   */
  useEffect(() => {
    if (!user) {
      setMyProfile(null);
      setDisplayName("");
      return;
    }

    loadMyProfile();
  }, [user]);

  async function loadMyProfile() {
    if (!user) return;

    const { data, error } =
      await sb
        .from("profiles")
        .select(
          "id,display_name,avatar_path,created_at"
        )
        .eq("id", user.id)
        .maybeSingle();

    if (error) {
      return;
    }

    if (data) {
      let avatarUrl = null;

      if (data.avatar_path) {
        const result =
          await sb.storage
            .from("gosnaps-avatars")
            .createSignedUrl(
              data.avatar_path,
              3600
            );

        avatarUrl =
          result.data?.signedUrl ||
          null;
      }

      const profile = {
        ...data,
        avatar_url: avatarUrl,
      };

      setMyProfile(profile);
      setDisplayName(
        data.display_name || ""
      );
    }
  }

  /*
   * LOGIN
   */
  async function login() {
    if (!email.trim()) {
      setToast(
        "Enter your email."
      );
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

  /*
   * PROFILE UPDATE
   */
  async function saveProfile() {
    if (!user) {
      setToast(
        "Sign in first."
      );
      return;
    }

    setSavingProfile(true);

    try {
      let avatarPath =
        myProfile?.avatar_path ||
        null;

      if (profileFile) {
        const extension =
          profileFile.name
            .split(".")
            .pop() ||
          "jpg";

        const path =
          `${user.id}/avatar-${Date.now()}.${extension}`;

        const upload =
          await sb.storage
            .from(
              "gosnaps-avatars"
            )
            .upload(
              path,
              profileFile,
              {
                upsert: true,
              }
            );

        if (upload.error) {
          setToast(
            upload.error.message
          );
          return;
        }

        avatarPath = path;
      }

      const { error } =
        await sb
          .from("profiles")
          .upsert({
            id: user.id,
            display_name:
              displayName.trim() ||
              "Academic Hunters member",
            avatar_path:
              avatarPath,
          });

      if (error) {
        setToast(
          error.message
        );
        return;
      }

      setProfileFile(null);

      await loadMyProfile();

      await loadMembers();

      setToast(
        "Profile updated successfully."
      );
    } finally {
      setSavingProfile(false);
    }
  }

  /*
   * MEMBERS
   */
  async function loadMembers() {
    setToast(
      "Loading members..."
    );

    const { data, error } =
      await sb
        .from("profiles")
        .select(
          "id,display_name,avatar_path,created_at"
        )
        .limit(100);

    if (error) {
      setToast(
        error.message
      );
      return;
    }

    const enriched: Member[] =
      [];

    for (const member of data || []) {
      let avatarUrl = null;

      if (member.avatar_path) {
        const result =
          await sb.storage
            .from(
              "gosnaps-avatars"
            )
            .createSignedUrl(
              member.avatar_path,
              3600
            );

        avatarUrl =
          result.data?.signedUrl ||
          null;
      }

      enriched.push({
        ...member,
        avatar_url: avatarUrl,
      });
    }

    setMembers(enriched);

    setToast(
      `${enriched.length} member(s) found`
    );
  }

  /*
   * STABLE CONVERSATION ID
   */
  async function makeConversationId(
    first: string,
    second: string
  ) {
    const value =
      `academic-hunters:${first}:${second}`;

    const bytes =
      new TextEncoder().encode(
        value
      );

    const hash =
      await crypto.subtle.digest(
        "SHA-256",
        bytes
      );

    const hex =
      Array.from(
        new Uint8Array(hash)
      )
        .map((b) =>
          b
            .toString(16)
            .padStart(2, "0")
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

  /*
   * OPEN PRIVATE CHAT
   */
  async function openPrivateChat(
    member: Member
  ) {
    if (!user) {
      setToast(
        "Sign in first."
      );
      return;
    }

    if (
      !member?.id ||
      member.id === user.id
    ) {
      setToast(
        "Invalid member."
      );
      return;
    }

    setPrivateLoading(true);

    try {
      const ids =
        [user.id, member.id].sort();

      const id =
        await makeConversationId(
          ids[0],
          ids[1]
        );

      /*
       * Create conversation.
       * Duplicate is okay because
       * the conversation already exists.
       */
      const conversation =
        await sb
          .from("conversations")
          .insert({
            id,
          });

      if (
        conversation.error &&
        !conversation.error.message
          .toLowerCase()
          .includes("duplicate")
      ) {
        setToast(
          conversation.error.message
        );
        return;
      }

      /*
       * Insert members separately.
       * This avoids the UPDATE/RLS problem
       * caused by upsert.
       */
      const firstMember =
        await sb
          .from(
            "conversation_members"
          )
          .insert({
            conversation_id: id,
            user_id: user.id,
          });

      if (
        firstMember.error &&
        !firstMember.error.message
          .toLowerCase()
          .includes("duplicate")
      ) {
        setToast(
          firstMember.error.message
        );
        return;
      }

      const secondMember =
        await sb
          .from(
            "conversation_members"
          )
          .insert({
            conversation_id: id,
            user_id: member.id,
          });

      if (
        secondMember.error &&
        !secondMember.error.message
          .toLowerCase()
          .includes("duplicate")
      ) {
        setToast(
          secondMember.error.message
        );
        return;
      }

      setSelectedMember(member);
      setConversationId(id);

      await loadPrivateMessages(id);

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

  /*
   * LOAD PRIVATE MESSAGES
   */
  async function loadPrivateMessages(
    id: string
  ) {
    setPrivateLoading(true);

    const { data, error } =
      await sb
        .from("private_messages")
        .select(
          "id,conversation_id,sender_id,content,created_at,read_at,file_path,file_name"
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
      setToast(
        error.message
      );
      setPrivateLoading(false);
      return;
    }

    setPrivateMessages(
      data || []
    );

    setPrivateLoading(false);

    /*
     * Mark incoming messages as read.
     */
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
        .is(
          "read_at",
          null
        );
    }
  }

  /*
   * PRIVATE REALTIME
   */
  useEffect(() => {
    if (
      !user ||
      !conversationId
    ) {
      return;
    }

    const channel =
      sb
        .channel(
          `private-chat:${conversationId}`
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table:
              "private_messages",
            filter:
              `conversation_id=eq.${conversationId}`,
          },
          async (payload) => {
            const incoming =
              payload.new as PrivateMessage;

            setPrivateMessages(
              (old) => {
                if (
                  old.some(
                    (m) =>
                      m.id ===
                      incoming.id
                  )
                ) {
                  return old;
                }

                return [
                  ...old,
                  incoming,
                ];
              }
            );

            /*
             * Automatically mark incoming
             * messages read while this chat
             * is open.
             */
            if (
              incoming.sender_id !==
                user.id &&
              !incoming.read_at
            ) {
              await sb
                .from(
                  "private_messages"
                )
                .update({
                  read_at:
                    new Date().toISOString(),
                })
                .eq(
                  "id",
                  incoming.id
                );
            }

            if (
              incoming.sender_id !==
              user.id
            ) {
              setToast(
                "New private message"
              );
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table:
              "private_messages",
            filter:
              `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const updated =
              payload.new as PrivateMessage;

            setPrivateMessages(
              (old) =>
                old.map((m) =>
                  m.id ===
                  updated.id
                    ? updated
                    : m
                )
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table:
              "private_messages",
            filter:
              `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const deleted =
              payload.old as PrivateMessage;

            setPrivateMessages(
              (old) =>
                old.filter(
                  (m) =>
                    m.id !==
                    deleted.id
                )
            );
          }
        )
        .subscribe();

    return () => {
      sb.removeChannel(
        channel
      );
    };
  }, [
    sb,
    user,
    conversationId,
  ]);

  /*
   * SEND PRIVATE MESSAGE
   */
  async function sendPrivateMessage() {
    if (!user) {
      setToast(
        "Sign in first."
      );
      return;
    }

    if (!conversationId) {
      setToast(
        "Open a private chat first."
      );
      return;
    }

    const value =
      privateText.trim();

    if (
      !value &&
      !privateFile
    ) {
      return;
    }

    setSending(true);

    try {
      let filePath =
        null;

      let fileName =
        null;

      if (privateFile) {
        const safeName =
          privateFile.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );

        filePath =
          `${conversationId}/${user.id}/${Date.now()}-${safeName}`;

        const upload =
          await sb.storage
            .from(
              "gosnaps-private-files"
            )
            .upload(
              filePath,
              privateFile
            );

        if (upload.error) {
          setToast(
            upload.error.message
          );
          return;
        }

        fileName =
          privateFile.name;
      }

      const { error } =
        await sb
          .from(
            "private_messages"
          )
          .insert({
            conversation_id:
              conversationId,
            sender_id:
              user.id,
            content:
              value ||
              "📎 File",
            file_path:
              filePath,
            file_name:
              fileName,
          });

      if (error) {
        setToast(
          error.message
        );
        return;
      }

      setPrivateText("");
      setPrivateFile(null);

      setToast(
        "Private message sent."
      );
    } finally {
      setSending(false);
    }
  }

  /*
   * DELETE PRIVATE MESSAGE
   */
  async function deletePrivateMessage(
    id: string,
    filePath?: string | null
  ) {
    if (!user) return;

    const { error } =
      await sb
        .from("private_messages")
        .delete()
        .eq("id", id)
        .eq(
          "sender_id",
          user.id
        );

    if (error) {
      setToast(
        error.message
      );
      return;
    }

    if (filePath) {
      await sb.storage
        .from(
          "gosnaps-private-files"
        )
        .remove([
          filePath,
        ]);
    }

    setToast(
      "Message deleted."
    );
  }

  /*
   * PRIVATE FILE OPEN
   */
  async function openPrivateFile(
    path: string
  ) {
    if (!user) return;

    const { data, error } =
      await sb.storage
        .from(
          "gosnaps-private-files"
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
          "Could not open file."
      );
      return;
    }

    window.open(
      data.signedUrl,
      "_blank",
      "noopener,noreferrer"
    );
  }

  /*
   * PRIVATE FILE DOWNLOAD
   */
  async function downloadPrivateFile(
    path: string,
    name: string
  ) {
    if (!user) return;

    const { data, error } =
      await sb.storage
        .from(
          "gosnaps-private-files"
        )
        .createSignedUrl(
          path,
          3600,
          {
            download:
              name ||
              true,
          }
        );

    if (
      error ||
      !data?.signedUrl
    ) {
      setToast(
        error?.message ||
          "Could not download file."
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

    document.body.appendChild(
      link
    );

    link.click();

    link.remove();
  }

  /*
   * CALLING
   */
  async function startMemberCall(
    member: Member,
    video: boolean
  ) {
    if (!user) {
      setToast(
        "Sign in before calling."
      );
      return;
    }

    if (
      !member?.id ||
      member.id === user.id
    ) {
      setToast(
        "Invalid member."
      );
      return;
    }

    if (callingMember) {
      setToast(
        "A call is already being started."
      );
      return;
    }

    setCallingMember(
      member.id
    );

    const room =
      crypto.randomUUID();

    const { error } =
      await sb
        .from(
          "call_invitations"
        )
        .insert({
          caller_id:
            user.id,
          receiver_id:
            member.id,
          room_id:
            room,
          video,
          status:
            "ringing",
        });

    if (error) {
      setCallingMember(null);
      setToast(
        error.message
      );
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
    if (!incomingCall)
      return;

    const accepted =
      incomingCall;

    const { error } =
      await sb
        .from(
          "call_invitations"
        )
        .update({
          status:
            "accepted",
        })
        .eq(
          "id",
          accepted.id
        );

    if (error) {
      setToast(
        error.message
      );
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
    if (!incomingCall)
      return;

    const { error } =
      await sb
        .from(
          "call_invitations"
        )
        .update({
          status:
            "rejected",
        })
        .eq(
          "id",
          incomingCall.id
        );

    if (error) {
      setToast(
        error.message
      );
      return;
    }

    setIncomingCall(null);

    setToast(
      "Call declined."
    );
  }

  /*
   * PUBLIC FILE OPEN
   */
  async function openFile(
    path: string
  ) {
    if (!user) {
      setToast(
        "Sign in first."
      );
      return;
    }

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
          "Could not open file."
      );
      return;
    }

    window.open(
      data.signedUrl,
      "_blank",
      "noopener,noreferrer"
    );
  }

  /*
   * PUBLIC FILE DOWNLOAD
   */
  async function downloadFile(
    path: string,
    name: string
  ) {
    if (!user) return;

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
              name ||
              true,
          }
        );

    if (
      error ||
      !data?.signedUrl
    ) {
      setToast(
        error?.message ||
          "Could not download file."
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

    document.body.appendChild(
      link
    );

    link.click();

    link.remove();
  }

  /*
   * PUBLIC / AI SEND
   */
  async function send() {
    if (sending) return;

    if (ai) {
      const q =
        text.trim();

      if (!q) return;

      setSending(true);
      setText("");

      try {
        const response =
          await fetch(
            "/api/chat",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  message: q,
                }),
            }
          );

        const data =
          await response.json();

        setMessages(
          (old) => [
            ...old,
            {
              id:
                Date.now(),
              sender:
                "Academic Hunters AI",
              text:
                data.reply ||
                data.error ||
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
      let attachmentPath =
        null;

      let attachmentName =
        null;

      if (file) {
        const safeName =
          file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );

        const path =
          `${user.id}/${Date.now()}-${safeName}`;

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

      const result =
        await sb
          .from("messages")
          .insert({
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
          });

      if (result.error) {
        setToast(
          result.error.message
        );
        return;
      }

      setText("");
      setFile(null);

      setToast(
        "Message sent."
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
    setPrivateFile(null);
  }

  function closeCall() {
    setCall(null);
    setCallingMember(null);
    setToast(
      "Call ended."
    );
  }

  const filteredMembers =
    members.filter(
      (m) => {
        if (
          !user ||
          m.id === user.id
        ) {
          return false;
        }

        const name =
          (
            m.display_name ||
            "Academic Hunters member"
          ).toLowerCase();

        return name.includes(
          memberSearch
            .trim()
            .toLowerCase()
        );
      }
    );

  return (
    <main className="wrap">

      {/* HEADER */}
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

      {/* HERO */}
      <section className="hero">
        <small>
          CONNECT • CHAT • CALL • CREATE
        </small>

        <h1>
          Welcome to Academic Hunters.
        </h1>

        <p>
          Real-time conversations,
          AI, private messaging,
          files and browser
          voice/video calling.
        </p>
      </section>

      {/* LOGIN */}
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

      {/* PROFILE */}
      {user && (
        <section
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
          <h3>
            👤 My Profile
          </h3>

          <div
            style={{
              display:
                "flex",
              gap:
                "12px",
              alignItems:
                "center",
              flexWrap:
                "wrap",
              marginTop:
                "10px",
            }}
          >
            {myProfile?.avatar_url ? (
              <img
                src={
                  myProfile.avatar_url
                }
                alt="Profile"
                style={{
                  width:
                    "58px",
                  height:
                    "58px",
                  borderRadius:
                    "50%",
                  objectFit:
                    "cover",
                }}
              />
            ) : (
              <div
                style={{
                  width:
                    "58px",
                  height:
                    "58px",
                  borderRadius:
                    "50%",
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  background:
                    "rgba(255,255,255,.15)",
                  fontSize:
                    "25px",
                }}
              >
                👤
              </div>
            )}

            <div
              style={{
                flex: 1,
                minWidth:
                  "180px",
              }}
            >
              <input
                value={
                  displayName
                }
                onChange={(
                  e
                ) =>
                  setDisplayName(
                    e.target
                      .value
                  )
                }
                placeholder="Your display name"
                style={{
                  width:
                    "100%",
                  boxSizing:
                    "border-box",
                  padding:
                    "10px",
                  borderRadius:
                    "9px",
                  border:
                    "1px solid rgba(255,255,255,.2)",
                }}
              />

              <input
                type="file"
                accept="image/*"
                onChange={(
                  e
                ) =>
                  setProfileFile(
                    e.target
                      .files?.[0] ||
                      null
                  )
                }
                style={{
                  marginTop:
                    "8px",
                }}
              />
            </div>

            <button
              type="button"
              onClick={
                saveProfile
              }
              disabled={
                savingProfile
              }
            >
              {savingProfile
                ? "Saving..."
                : "Save Profile"}
            </button>
          </div>
        </section>
      )}

      {/* NAVIGATION */}
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

      {/* TOAST */}
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

      {/* INCOMING CALL */}
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
              gap:
                "10px",
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

      {/* MEMBERS */}
      {members.length > 0 && (
        <aside className="members">
          <h3>
            👥 Academic Hunters Members
          </h3>

          <input
            type="search"
            value={
              memberSearch
            }
            onChange={(
              e
            ) =>
              setMemberSearch(
                e.target
                  .value
              )
            }
            placeholder="🔎 Search members..."
            style={{
              width:
                "100%",
              padding:
                "11px 13px",
              borderRadius:
                "10px",
              border:
                "1px solid rgba(255,255,255,.18)",
              outline:
                "none",
              marginBottom:
                "12px",
              boxSizing:
                "border-box",
            }}
          />

          {filteredMembers.length ===
          0 ? (
            <div
              style={{
                padding:
                  "14px",
                borderRadius:
                  "12px",
                background:
                  "rgba(255,255,255,.08)",
              }}
            >
              {memberSearch.trim()
                ? "No members found."
                : "No other members available."}
            </div>
          ) : (
            filteredMembers.map(
              (m) => (
                <div
                  key={
                    m.id
                  }
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
                  <div
                    style={{
                      display:
                        "flex",
                      gap:
                        "10px",
                      alignItems:
                        "center",
                    }}
                  >
                    {m.avatar_url ? (
                      <img
                        src={
                          m.avatar_url
                        }
                        alt=""
                        style={{
                          width:
                            "42px",
                          height:
                            "42px",
                          borderRadius:
                            "50%",
                          objectFit:
                            "cover",
                        }}
                      />
                    ) : (
                      <div>
                        👤
                      </div>
                    )}

                    <div>
                      <div>
                        <span
                          style={{
                            color:
                              onlineUsers[
                                m.id
                              ]
                                ? "#31d158"
                                : "#999",
                          }}
                        >
                          ●
                        </span>{" "}
                        {m.display_name ||
                          "Academic Hunters member"}
                      </div>

                      <small
                        style={{
                          opacity:
                            0.7,
                        }}
                      >
                        {onlineUsers[
                          m.id
                        ]
                          ? "Online"
                          : "Offline"}
                      </small>
                    </div>
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
              )
            )
          )}
        </aside>
      )}

      {/* PRIVATE CHAT */}
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
                gap:
                  "10px",
                marginBottom:
                  "12px",
              }}
            >
              <div>
                <b>
                  💬 Private Chat
                </b>

                <div
                  style={{
                    marginTop:
                      "4px",
                  }}
                >
                  {selectedMember.avatar_url && (
                    <img
                      src={
                        selectedMember.avatar_url
                      }
                      alt=""
                      style={{
                        width:
                          "30px",
                        height:
                          "30px",
                        borderRadius:
                          "50%",
                        objectFit:
                          "cover",
                        verticalAlign:
                          "middle",
                        marginRight:
                          "7px",
                      }}
                    />
                  )}

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
                  "350px",
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
                          "10px 11px",
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
                      <div
                        style={{
                          display:
                            "flex",
                          justifyContent:
                            "space-between",
                          gap:
                            "8px",
                        }}
                      >
                        <b>
                          {m.sender_id ===
                          user?.id
                            ? "You"
                            : selectedMember.display_name ||
                              "Member"}
                        </b>

                        {m.sender_id ===
                          user?.id && (
                          <button
                            type="button"
                            onClick={() =>
                              deletePrivateMessage(
                                m.id,
                                m.file_path
                              )
                            }
                            style={{
                              fontSize:
                                "11px",
                            }}
                          >
                            🗑️
                          </button>
                        )}
                      </div>

                      <p
                        style={{
                          whiteSpace:
                            "pre-wrap",
                        }}
                      >
                        {
                          m.content
                        }
                      </p>

                      {m.file_path && (
                        <div
                          style={{
                            display:
                              "flex",
                            gap:
                              "7px",
                            flexWrap:
                              "wrap",
                            marginTop:
                              "7px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              openPrivateFile(
                                m.file_path!
                              )
                            }
                          >
                            📂 Open{" "}
                            {
                              m.file_name
                            }
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              downloadPrivateFile(
                                m.file_path!,
                                m.file_name ||
                                  "file"
                              )
                            }
                          >
                            ⬇️ Download
                          </button>
                        </div>
                      )}

                      <small
                        style={{
                          opacity:
                            0.7,
                        }}
                      >
                        {new Date(
                          m.created_at
                        ).toLocaleString()}

                        {m.sender_id ===
                          user?.id &&
                          m.read_at
                          ? " • ✓✓ Read"
                          : ""}
                      </small>
                    </article>
                  )
                )
              )}
            </div>

            {/* PRIVATE FILE */}
            {privateFile && (
              <div
                style={{
                  marginTop:
                    "8px",
                  padding:
                    "8px",
                  borderRadius:
                    "8px",
                  background:
                    "rgba(255,255,255,.08)",
                }}
              >
                📎{" "}
                {
                  privateFile.name
                }

                <button
                  type="button"
                  onClick={() =>
                    setPrivateFile(
                      null
                    )
                  }
                  style={{
                    marginLeft:
                      "8px",
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            <div
              style={{
                display:
                  "flex",
                gap:
                  "8px",
                marginTop:
                  "10px",
                alignItems:
                  "center",
              }}
            >
              <label>
                📎
                <input
                  type="file"
                  style={{
                    display:
                      "none",
                  }}
                  onChange={(
                    e
                  ) =>
                    setPrivateFile(
                      e.target
                        .files?.[0] ||
                      null
                    )
                  }
                />
              </label>

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
                    !e.shiftKey &&
                    !sending
                  ) {
                    e.preventDefault();
                    sendPrivateMessage();
                  }
                }}
                placeholder="Write a private message..."
                style={{
                  flex:
                    1,
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

      {/* PUBLIC CHAT */}
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

                {m.created_at && (
                  <small
                    style={{
                      opacity:
                        0.6,
                    }}
                  >
                    {new Date(
                      m.created_at
                    ).toLocaleString()}
                  </small>
                )}
              </article>
            );
          }
        )}
      </section>

      {/* PUBLIC COMPOSER */}
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

      {/* CALL */}
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
