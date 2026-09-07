"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";
import Call from "./Call";

type Section =
  | "home"
  | "messages"
  | "ai"
  | "members"
  | "profile";

type CallState = {
  room: string;
  video: boolean;
  initiator: boolean;
  invitationId: string;
};

type IncomingCall = {
  id: string;
  caller_id: string;
  caller_name: string;
  room_id: string;
  video: boolean;
  expires_at?: string | null;
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
  file_size?: number | null;
  mime_type?: string | null;
};

type Member = {
  id: string;
  display_name?: string | null;
  avatar_path?: string | null;
  created_at?: string;
  avatar_url?: string | null;
};

function isDuplicateError(error: any) {
  if (!error) return false;

  return (
    error.code === "23505" ||
    /duplicate|already exists/i.test(
      error.message || ""
    )
  );
}

export default function App() {
  const sb = useRef(getSupabase()).current;

  const [section, setSection] =
    useState<Section>("home");

  const [user, setUser] =
    useState<any>(null);

  const [email, setEmail] =
    useState("");

  const [members, setMembers] =
    useState<Member[]>([]);

  const [memberSearch, setMemberSearch] =
    useState("");

  const [messages, setMessages] =
    useState<any[]>([]);

  const [privateMessages, setPrivateMessages] =
    useState<PrivateMessage[]>([]);

  const [text, setText] =
    useState("");

  const [privateText, setPrivateText] =
    useState("");

  const [file, setFile] =
    useState<File | null>(null);

  const [privateFile, setPrivateFile] =
    useState<File | null>(null);

  const [call, setCall] =
    useState<CallState | null>(null);

  const callRef =
    useRef<CallState | null>(null);

  const [incomingCall, setIncomingCall] =
    useState<IncomingCall | null>(null);

  const [toast, setToast] =
    useState("");

  const [online, setOnline] =
    useState(0);

  const [onlineUsers, setOnlineUsers] =
    useState<Record<string, boolean>>({});

  const [sending, setSending] =
    useState(false);

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

  const [
    notificationPermission,
    setNotificationPermission,
  ] = useState<
    NotificationPermission | "unsupported"
  >("default");

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  /*
   * BROWSER NOTIFICATIONS
   */
  const notifyBrowser = useCallback(
    (
      title: string,
      body: string
    ) => {
      try {
        if (
          typeof window === "undefined" ||
          !("Notification" in window)
        ) {
          return;
        }

        if (
          Notification.permission ===
          "granted"
        ) {
          new Notification(title, {
            body,
            icon: "/favicon.ico",
          });
        }
      } catch {}
    },
    []
  );

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window
    ) {
      setNotificationPermission(
        Notification.permission
      );
    } else {
      setNotificationPermission(
        "unsupported"
      );
    }
  }, []);

  async function enableNotifications() {
    if (
      typeof window === "undefined" ||
      !("Notification" in window)
    ) {
      setToast(
        "This browser does not support notifications."
      );
      return;
    }

    try {
      const permission =
        await Notification.requestPermission();

      setNotificationPermission(
        permission
      );

      if (permission === "granted") {
        setToast(
          "Notifications enabled."
        );
      } else if (
        permission === "denied"
      ) {
        setToast(
          "Notifications are blocked in your browser."
        );
      } else {
        setToast(
          "Notification permission was not granted."
        );
      }
    } catch {
      setToast(
        "Could not enable notifications."
      );
    }
  }

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

    const auth =
      sb.auth.onAuthStateChange(
        (_event, session) => {
          if (mounted) {
            setUser(
              session?.user ?? null
            );
          }
        }
      );

    return () => {
      mounted = false;
      auth.data.subscription.unsubscribe();
    };
  }, [sb]);

  /*
   * LOAD OWN PROFILE
   */
  useEffect(() => {
    if (!user) {
      setMyProfile(null);
      setDisplayName("");
      return;
    }

    void loadMyProfile();
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

    if (error) return;

    if (data) {
      let avatarUrl:
        | string
        | null = null;

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

      const profile: Member = {
        ...data,
        avatar_url: avatarUrl,
      };

      setMyProfile(profile);
      setDisplayName(
        data.display_name || ""
      );
    } else {
      const fallbackName =
        user.user_metadata
          ?.display_name ||
        user.email?.split("@")[0] ||
        "Academic Hunters member";

      const created =
        await sb
          .from("profiles")
          .insert({
            id: user.id,
            display_name: fallbackName,
          });

      if (!created.error) {
        setDisplayName(
          fallbackName
        );

        await loadMyProfile();
      }
    }
  }

  /*
   * MEMBERS
   */
  async function loadMembers() {
    const { data, error } =
      await sb
        .from("profiles")
        .select(
          "id,display_name,avatar_path,created_at"
        )
        .limit(100);

    if (error) {
      setToast(error.message);
      return;
    }

    const enriched: Member[] = [];

    for (
      const member of data || []
    ) {
      let avatarUrl:
        | string
        | null = null;

      if (member.avatar_path) {
        const result =
          await sb.storage
            .from("gosnaps-avatars")
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
  }

  /*
   * PUBLIC CHAT / PRESENCE / CALLS /
   * NOTIFICATIONS
   */
  useEffect(() => {
    if (!user) {
      setOnline(0);
      setOnlineUsers({});
      setIncomingCall(null);
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
          if (!mounted) return;

          setMessages((old) => {
            const exists = old.some(
              (m) =>
                m.id ===
                payload.new.id
            );

            return exists
              ? old
              : [
                  ...old,
                  payload.new,
                ];
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
        if (
          mounted &&
          data
        ) {
          setMessages(data);
        }
      });

    /*
     * PRESENCE
     */
    const presence =
      sb.channel(
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
      .subscribe(
        async (status) => {
          if (
            status ===
            "SUBSCRIBED"
          ) {
            try {
              await presence.track({
                user_id: user.id,
                online_at:
                  new Date().toISOString(),
              });

              updatePresence();
            } catch {}
          }
        }
      );

    /*
     * CALL INVITATIONS
     */
    const calls =
      sb
        .channel(
          "gosnaps-call-invitations"
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table:
              "call_invitations",
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

            if (
              invitation.expires_at &&
              new Date(
                invitation.expires_at
              ).getTime() <=
                Date.now()
            ) {
              await sb
                .from(
                  "call_invitations"
                )
                .update({
                  status: "expired",
                  ended_at:
                    new Date().toISOString(),
                })
                .eq(
                  "id",
                  invitation.id
                )
                .eq(
                  "status",
                  "ringing"
                );

              return;
            }

            if (callRef.current) {
              await sb
                .from(
                  "call_invitations"
                )
                .update({
                  status: "rejected",
                  ended_at:
                    new Date().toISOString(),
                })
                .eq(
                  "id",
                  invitation.id
                )
                .eq(
                  "status",
                  "ringing"
                );

              return;
            }

            let callerName =
              "Academic Hunters member";

            const {
              data: profile,
            } = await sb
              .from("profiles")
              .select(
                "display_name"
              )
              .eq(
                "id",
                invitation.caller_id
              )
              .maybeSingle();

            if (
              profile?.display_name
            ) {
              callerName =
                profile.display_name;
            }

            const incoming:
              IncomingCall = {
                id:
                  invitation.id,
                caller_id:
                  invitation.caller_id,
                caller_name:
                  callerName,
                room_id:
                  invitation.room_id,
                video:
                  Boolean(
                    invitation.video
                  ),
                expires_at:
                  invitation.expires_at ??
                  null,
              };

            setIncomingCall(
              incoming
            );

            setToast(
              invitation.video
                ? `Incoming video call from ${callerName}`
                : `Incoming voice call from ${callerName}`
            );

            notifyBrowser(
              invitation.video
                ? "Incoming video call"
                : "Incoming voice call",
              `${callerName} is calling you.`
            );

            if (
              invitation.expires_at
            ) {
              const remaining =
                Math.max(
                  0,
                  new Date(
                    invitation.expires_at
                  ).getTime() -
                    Date.now()
                );

              window.setTimeout(
                async () => {
                  if (!mounted)
                    return;

                  setIncomingCall(
                    (current) =>
                      current?.id ===
                      invitation.id
                        ? null
                        : current
                  );

                  await sb
                    .from(
                      "call_invitations"
                    )
                    .update({
                      status:
                        "expired",
                      ended_at:
                        new Date().toISOString(),
                    })
                    .eq(
                      "id",
                      invitation.id
                    )
                    .eq(
                      "status",
                      "ringing"
                    );
                },
                remaining
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
              "call_invitations",
          },
          (payload) => {
            if (!mounted) return;

            const invitation =
              payload.new as any;

            if (
              invitation.caller_id ===
              user.id
            ) {
              if (
                invitation.status ===
                "accepted"
              ) {
                setCallingMember(null);

                setCall({
                  room:
                    invitation.room_id,
                  video:
                    Boolean(
                      invitation.video
                    ),
                  initiator: true,
                  invitationId:
                    invitation.id,
                });

                setToast(
                  "Call accepted. Connecting..."
                );

                return;
              }

              if (
                invitation.status ===
                  "rejected" ||
                invitation.status ===
                  "expired" ||
                invitation.status ===
                  "cancelled" ||
                invitation.status ===
                  "ended"
              ) {
                setCallingMember(null);

                if (
                  callRef.current
                    ?.invitationId ===
                  invitation.id
                ) {
                  setCall(null);
                }

                if (
                  invitation.status ===
                  "rejected"
                ) {
                  setToast(
                    "The member declined the call."
                  );
                } else if (
                  invitation.status ===
                  "expired"
                ) {
                  setToast(
                    "The call invitation expired."
                  );
                } else if (
                  invitation.status ===
                  "ended"
                ) {
                  setToast(
                    "The call ended."
                  );
                }

                return;
              }
            }

            if (
              invitation.receiver_id ===
              user.id
            ) {
              if (
                invitation.status ===
                  "cancelled" ||
                invitation.status ===
                  "expired" ||
                invitation.status ===
                  "ended" ||
                invitation.status ===
                  "rejected"
              ) {
                setIncomingCall(
                  (current) =>
                    current?.id ===
                    invitation.id
                      ? null
                      : current
                );

                if (
                  callRef.current
                    ?.invitationId ===
                  invitation.id
                ) {
                  setCall(null);
                }
              }
            }
          }
        )
        .subscribe();

    /*
     * PRIVATE MESSAGE NOTIFICATIONS
     */
    const privateNotifications =
      sb
        .channel(
          "gosnaps-private-notifications"
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table:
              "private_messages",
          },
          async (payload) => {
            if (!mounted) return;

            const incoming =
              payload.new as PrivateMessage;

            if (
              incoming.sender_id ===
              user.id
            ) {
              return;
            }

            if (
              incoming.conversation_id ===
              conversationId
            ) {
              return;
            }

            let senderName =
              "Academic Hunters member";

            const {
              data: sender,
            } = await sb
              .from("profiles")
              .select(
                "display_name"
              )
              .eq(
                "id",
                incoming.sender_id
              )
              .maybeSingle();

            if (
              sender?.display_name
            ) {
              senderName =
                sender.display_name;
            }

            const body =
              incoming.file_name
                ? `${senderName} sent you a file: ${incoming.file_name}`
                : `${senderName}: ${incoming.content}`;

            setToast(
              "New private message"
            );

            notifyBrowser(
              "Academic Hunters",
              body
            );
          }
        )
        .subscribe();

    /*
     * NEW MEMBERS
     */
    const profileNotifications =
      sb
        .channel(
          "gosnaps-new-members"
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "profiles",
          },
          (payload) => {
            if (!mounted) return;

            const profile =
              payload.new as any;

            if (
              profile.id ===
              user.id
            ) {
              return;
            }

            const name =
              profile.display_name ||
              "A new member";

            setToast(
              `${name} joined Academic Hunters.`
            );

            notifyBrowser(
              "New Academic Hunters member",
              `${name} joined Academic Hunters.`
            );

            void loadMembers();
          }
        )
        .subscribe();

    return () => {
      mounted = false;

      sb.removeChannel(msg);
      sb.removeChannel(presence);
      sb.removeChannel(calls);
      sb.removeChannel(
        privateNotifications
      );
      sb.removeChannel(
        profileNotifications
      );
    };
  }, [
    sb,
    user,
    conversationId,
    notifyBrowser,
  ]);

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
   * PROFILE
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

      const oldAvatarPath =
        myProfile?.avatar_path ||
        null;

      if (profileFile) {
        if (
          !profileFile.type.startsWith(
            "image/"
          )
        ) {
          setToast(
            "Please choose an image."
          );
          return;
        }

        const extension =
          profileFile.name
            .split(".")
            .pop() ||
          "jpg";

        const safeExtension =
          extension.replace(
            /[^a-zA-Z0-9]/g,
            ""
          ) || "jpg";

        const path =
          `${user.id}/avatar-${Date.now()}.${safeExtension}`;

        const upload =
          await sb.storage
            .from("gosnaps-avatars")
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
        setToast(error.message);
        return;
      }

      if (
        profileFile &&
        oldAvatarPath &&
        oldAvatarPath !==
          avatarPath
      ) {
        await sb.storage
          .from("gosnaps-avatars")
          .remove([
            oldAvatarPath,
          ]);
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
   * PRIVATE CHAT
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

      const conversation =
        await sb
          .from("conversations")
          .insert({ id });

      if (
        conversation.error &&
        !isDuplicateError(
          conversation.error
        )
      ) {
        setToast(
          conversation.error.message
        );
        return;
      }

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
        !isDuplicateError(
          firstMember.error
        )
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
        !isDuplicateError(
          secondMember.error
        )
      ) {
        setToast(
          secondMember.error.message
        );
        return;
      }

      await loadPrivateMessages(id);

      setSelectedMember(member);
      setConversationId(id);
      setSection("messages");

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

  async function loadPrivateMessages(
    id: string
  ) {
    const { data, error } =
      await sb
        .from("private_messages")
        .select(
          "id,conversation_id,sender_id,content,created_at,read_at,file_path,file_name,file_size,mime_type"
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
      return;
    }

    const loaded =
      (data || []) as PrivateMessage[];

    if (user) {
      const unreadIds =
        loaded
          .filter(
            (message) =>
              message.sender_id !==
                user.id &&
              !message.read_at
          )
          .map(
            (message) =>
              message.id
          );

      if (unreadIds.length) {
        const readAt =
          new Date().toISOString();

        await sb
          .from("private_messages")
          .update({
            read_at: readAt,
          })
          .in(
            "id",
            unreadIds
          );

        for (
          const message of loaded
        ) {
          if (
            unreadIds.includes(
              message.id
            )
          ) {
            message.read_at =
              readAt;
          }
        }
      }
    }

    setPrivateMessages(loaded);
  }

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

            if (
              incoming.sender_id !==
                user.id &&
              !incoming.read_at
            ) {
              const readAt =
                new Date().toISOString();

              await sb
                .from(
                  "private_messages"
                )
                .update({
                  read_at:
                    readAt,
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
                old.map(
                  (message) =>
                    message.id ===
                    updated.id
                      ? updated
                      : message
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
                  (message) =>
                    message.id !==
                    deleted.id
                )
            );
          }
        )
        .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [
    sb,
    user,
    conversationId,
  ]);

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

    if (
      privateFile &&
      privateFile.size >
        25 * 1024 * 1024
    ) {
      setToast(
        "Private files must be 25 MB or smaller."
      );
      return;
    }

    setSending(true);

    try {
      let filePath:
        | string
        | null = null;

      let fileName:
        | string
        | null = null;

      let fileSize:
        | number
        | null = null;

      let mimeType:
        | string
        | null = null;

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

        fileSize =
          privateFile.size;

        mimeType =
          privateFile.type ||
          "application/octet-stream";
      }

      const { error } =
        await sb
          .from("private_messages")
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
            file_size:
              fileSize,
            mime_type:
              mimeType,
          });

      if (error) {
        if (filePath) {
          await sb.storage
            .from(
              "gosnaps-private-files"
            )
            .remove([
              filePath,
            ]);
        }

        setToast(error.message);
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
      setToast(error.message);
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

    setPrivateMessages(
      (old) =>
        old.filter(
          (message) =>
            message.id !== id
        )
    );

    setToast(
      "Message deleted."
    );
  }

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
              name || true,
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
      document.createElement("a");

    link.href =
      data.signedUrl;

    link.download =
      name ||
      "Academic-Hunters-file";

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function closePrivateChat() {
    setSelectedMember(null);
    setConversationId(null);
    setPrivateMessages([]);
    setPrivateText("");
    setPrivateFile(null);
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

    if (
      callingMember ||
      callRef.current
    ) {
      setToast(
        "You already have a call in progress."
      );
      return;
    }

    setCallingMember(member.id);

    try {
      const {
        data: activeCall,
      } = await sb
        .from("call_invitations")
        .select(
          "id,status,expires_at"
        )
        .eq(
          "caller_id",
          user.id
        )
        .in("status", [
          "ringing",
          "accepted",
        ])
        .limit(1)
        .maybeSingle();

      if (activeCall) {
        setCallingMember(null);
        setToast(
          "You already have an active call."
        );
        return;
      }

      const room =
        crypto.randomUUID();

      const expiresAt =
        new Date(
          Date.now() + 60000
        ).toISOString();

      const {
        data: invitation,
        error,
      } = await sb
        .from("call_invitations")
        .insert({
          caller_id: user.id,
          receiver_id: member.id,
          room_id: room,
          video,
          status: "ringing",
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (
        error ||
        !invitation
      ) {
        setCallingMember(null);

        setToast(
          error?.message ||
            "Could not start the call."
        );

        return;
      }

      setToast(
        `Calling ${
          member.display_name ||
          "member"
        }...`
      );

      window.setTimeout(
        async () => {
          if (callRef.current) {
            return;
          }

          const { data } =
            await sb
              .from(
                "call_invitations"
              )
              .select("status")
              .eq(
                "id",
                invitation.id
              )
              .maybeSingle();

          if (
            data?.status ===
            "ringing"
          ) {
            await sb
              .from(
                "call_invitations"
              )
              .update({
                status:
                  "expired",
                ended_at:
                  new Date().toISOString(),
              })
              .eq(
                "id",
                invitation.id
              )
              .eq(
                "status",
                "ringing"
              );

            setCallingMember(null);

            setToast(
              "No answer. Call invitation expired."
            );
          }
        },
        60500
      );
    } catch (error: any) {
      setCallingMember(null);

      setToast(
        error?.message ||
          "Could not start the call."
      );
    }
  }

  /*
   * ACCEPT CALL
   */
  async function acceptCall() {
    if (
      !incomingCall ||
      !user
    ) {
      return;
    }

    if (callRef.current) {
      setToast(
        "You are already on a call."
      );
      return;
    }

    const accepted =
      incomingCall;

    const {
      data: invitation,
      error: fetchError,
    } = await sb
      .from("call_invitations")
      .select(
        "id,caller_id,receiver_id,room_id,video,status,expires_at"
      )
      .eq("id", accepted.id)
      .eq(
        "receiver_id",
        user.id
      )
      .maybeSingle();

    if (
      fetchError ||
      !invitation
    ) {
      setIncomingCall(null);

      setToast(
        fetchError?.message ||
          "This call is no longer available."
      );

      return;
    }

    if (
      invitation.status !==
      "ringing"
    ) {
      setIncomingCall(null);

      setToast(
        "This call is no longer ringing."
      );

      return;
    }

    if (
      invitation.expires_at &&
      new Date(
        invitation.expires_at
      ).getTime() <=
        Date.now()
    ) {
      await sb
        .from("call_invitations")
        .update({
          status: "expired",
          ended_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          accepted.id
        )
        .eq(
          "status",
          "ringing"
        );

      setIncomingCall(null);

      setToast(
        "This call invitation has expired."
      );

      return;
    }

    const { error } =
      await sb
        .from("call_invitations")
        .update({
          status: "accepted",
          answered_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          accepted.id
        )
        .eq(
          "receiver_id",
          user.id
        )
        .eq(
          "status",
          "ringing"
        );

    if (error) {
      setToast(error.message);
      return;
    }

    setIncomingCall(null);

    setCall({
      room: accepted.room_id,
      video: accepted.video,
      initiator: false,
      invitationId:
        accepted.id,
    });

    setSection("home");

    setToast(
      "Call accepted. Connecting..."
    );
  }

  /*
   * REJECT CALL
   */
  async function rejectCall() {
    if (
      !incomingCall ||
      !user
    ) {
      return;
    }

    const rejected =
      incomingCall;

    const { error } =
      await sb
        .from("call_invitations")
        .update({
          status: "rejected",
          ended_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          rejected.id
        )
        .eq(
          "receiver_id",
          user.id
        )
        .eq(
          "status",
          "ringing"
        );

    if (error) {
      setToast(error.message);
      return;
    }

    setIncomingCall(null);

    setToast(
      "Call declined."
    );
  }

  /*
   * PUBLIC FILES
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

  async function downloadFile(
    path: string,
    name: string
  ) {
    if (!user) return;

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
          "Could not download file."
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

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /*
   * PUBLIC / AI SEND
   */
  async function send() {
    if (sending) return;

    if (section === "ai") {
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
                `ai-${Date.now()}`,
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

    if (
      file &&
      file.size >
        25 * 1024 * 1024
    ) {
      setToast(
        "Files must be 25 MB or smaller."
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
        const safeName =
          file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );

        const path =
          `${user.id}/${Date.now()}-${safeName}`;

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

      const result =
        await sb
          .from("messages")
          .insert({
            sender_id:
              user.id,
            receiver_id:
              null,
            sender:
              myProfile?.display_name ||
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
        if (attachmentPath) {
          await sb.storage
            .from("gosnaps-files")
            .remove([
              attachmentPath,
            ]);
        }

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

  /*
   * CLOSE CALL
   */
  const closeCall =
    useCallback(
      async () => {
        const currentCall =
          callRef.current;

        setCall(null);
        setCallingMember(null);

        if (
          currentCall?.invitationId
        ) {
          const now =
            new Date().toISOString();

          await sb
            .from(
              "call_invitations"
            )
            .update({
              status: "ended",
              ended_at: now,
            })
            .eq(
              "id",
              currentCall.invitationId
            )
            .in(
              "status",
              [
                "ringing",
                "accepted",
              ]
            );
        }

        setToast(
          "Call ended."
        );
      },
      [sb]
    );

  /*
   * FILTER MEMBERS
   */
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

  /*
   * NAVIGATION HELPER
   */
  function navigate(
    next: Section
  ) {
    setSection(next);

    if (
      next === "members" &&
      user
    ) {
      void loadMembers();
    }

    if (
      next === "profile" &&
      user
    ) {
      void loadMyProfile();
    }
  }

  /*
   * NOT LOGGED IN
   */
  if (!user) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(135deg,#07111f,#102a43)",
          color: "#fff",
          padding: "20px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: "500px",
            margin: "0 auto",
            paddingTop: "12vh",
          }}
        >
          <div
            style={{
              textAlign: "center",
              marginBottom: "30px",
            }}
          >
            <div
              style={{
                fontSize: "28px",
                fontWeight: 900,
                letterSpacing: "1px",
              }}
            >
              ACADEMIC{" "}
              <span
                style={{
                  opacity: 0.65,
                }}
              >
                HUNTERS
              </span>
            </div>

            <p
              style={{
                opacity: 0.75,
              }}
            >
              CONNECT • CHAT • CALL • CREATE
            </p>
          </div>

          <section
            style={{
              padding: "24px",
              borderRadius: "20px",
              background:
                "rgba(255,255,255,.09)",
              border:
                "1px solid rgba(255,255,255,.12)",
            }}
          >
            <h1>
              Welcome to Academic Hunters
            </h1>

            <p
              style={{
                opacity: 0.75,
                lineHeight: 1.6,
              }}
            >
              Real-time conversations,
              AI, private messaging,
              files and browser
              voice/video calling.
            </p>

            <input
              value={email}
              onChange={(e) =>
                setEmail(
                  e.target.value
                )
              }
              placeholder="Email address"
              type="email"
              autoComplete="email"
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                padding: "14px",
                marginTop: "15px",
                borderRadius: "12px",
                border:
                  "1px solid rgba(255,255,255,.2)",
                background:
                  "rgba(255,255,255,.1)",
                color: "#fff",
                outline: "none",
              }}
            />

            <button
              onClick={login}
              disabled={sending}
              style={{
                width: "100%",
                marginTop: "12px",
                padding: "14px",
                border: "none",
                borderRadius: "12px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Sign in
            </button>
          </section>
        </div>
      </main>
    );
  }

  /*
   * DASHBOARD
   */
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg,#07111f,#102a43)",
        color: "#fff",
        boxSizing: "border-box",
        paddingBottom: "30px",
      }}
    >
      {/* TOP BAR */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent:
            "space-between",
          gap: "12px",
          padding:
            "13px 16px",
          background:
            "rgba(7,17,31,.95)",
          backdropFilter:
            "blur(15px)",
          borderBottom:
            "1px solid rgba(255,255,255,.1)",
        }}
      >
        <button
          onClick={() =>
            navigate("home")
          }
          style={{
            border: "none",
            background: "none",
            color: "#fff",
            fontSize: "18px",
            fontWeight: 900,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ACADEMIC{" "}
          <span
            style={{
              opacity: 0.6,
            }}
          >
            HUNTERS
          </span>
        </button>

        <div
          style={{
            fontSize: "12px",
            opacity: 0.8,
          }}
        >
          ● {online} online
        </div>
      </header>

      <div
        style={{
          display: "flex",
          maxWidth: "1400px",
          margin: "0 auto",
          minHeight:
            "calc(100vh - 60px)",
        }}
      >
        {/* SIDEBAR */}
        <aside
          style={{
            width: "220px",
            flexShrink: 0,
            padding: "18px 12px",
            borderRight:
              "1px solid rgba(255,255,255,.08)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              opacity: 0.5,
              fontWeight: 800,
              margin:
                "4px 10px 10px",
              letterSpacing:
                "1px",
            }}
          >
            DASHBOARD
          </div>

          {[
            ["home", "🏠", "Home"],
            [
              "messages",
              "💬",
              "Messages",
            ],
            [
              "ai",
              "✨",
              "Academic Hunters AI",
            ],
            [
              "members",
              "👥",
              "Members",
            ],
            [
              "profile",
              "👤",
              "My Profile",
            ],
          ].map(
            ([id, icon, label]) => (
              <button
                key={id}
                onClick={() =>
                  navigate(
                    id as Section
                  )
                }
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems:
                    "center",
                  gap: "10px",
                  padding:
                    "12px 13px",
                  marginBottom:
                    "6px",
                  border: "none",
                  borderRadius:
                    "11px",
                  background:
                    section === id
                      ? "rgba(255,255,255,.14)"
                      : "transparent",
                  color: "#fff",
                  textAlign: "left",
                  fontWeight:
                    section === id
                      ? 800
                      : 500,
                  cursor:
                    "pointer",
                }}
              >
                <span>
                  {icon}
                </span>
                <span
                  style={{
                    fontSize:
                      "13px",
                  }}
                >
                  {label}
                </span>
              </button>
            )
          )}

          <div
            style={{
              height: "1px",
              background:
                "rgba(255,255,255,.1)",
              margin:
                "16px 8px",
            }}
          />

          <div
            style={{
              fontSize: "11px",
              opacity: 0.5,
              fontWeight: 800,
              margin:
                "4px 10px 10px",
              letterSpacing:
                "1px",
            }}
          >
            CALLS
          </div>

          <button
            onClick={() => {
              navigate("members");
              setToast(
                "Choose a member for a voice call."
              );
            }}
            style={{
              width: "100%",
              padding:
                "11px 13px",
              marginBottom:
                "6px",
              border: "none",
              borderRadius:
                "11px",
              background:
                "transparent",
              color: "#fff",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            📞 Voice Call
          </button>

          <button
            onClick={() => {
              navigate("members");
              setToast(
                "Choose a member for a video call."
              );
            }}
            style={{
              width: "100%",
              padding:
                "11px 13px",
              border: "none",
              borderRadius:
                "11px",
              background:
                "transparent",
              color: "#fff",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            🎥 Video Call
          </button>
        </aside>

        {/* MAIN CONTENT */}
        <section
          style={{
            flex: 1,
            minWidth: 0,
            padding: "20px",
            boxSizing: "border-box",
          }}
        >
          {/* HOME */}
          {section === "home" && (
            <div>
              <div
                style={{
                  padding:
                    "25px",
                  borderRadius:
                    "20px",
                  background:
                    "rgba(255,255,255,.07)",
                  border:
                    "1px solid rgba(255,255,255,.1)",
                  marginBottom:
                    "18px",
                }}
              >
                <small
                  style={{
                    opacity: 0.65,
                    fontWeight: 800,
                  }}
                >
                  CONNECT • CHAT • CALL • CREATE
                </small>

                <h1
                  style={{
                    fontSize:
                      "clamp(25px,5vw,40px)",
                    margin:
                      "12px 0 8px",
                  }}
                >
                  Welcome to Academic Hunters.
                </h1>

                <p
                  style={{
                    opacity: 0.75,
                    lineHeight:
                      1.6,
                    maxWidth:
                      "700px",
                  }}
                >
                  Your academic communication
                  dashboard. Chat with members,
                  use Academic Hunters AI, share
                  files and make voice or video
                  calls.
                </p>
              </div>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(170px,1fr))",
                  gap: "12px",
                }}
              >
                {[
                  [
                    "💬",
                    "Messages",
                    "Chat with members",
                    "messages",
                  ],
                  [
                    "✨",
                    "Academic Hunters AI",
                    "Ask questions",
                    "ai",
                  ],
                  [
                    "👥",
                    "Members",
                    `${online} online`,
                    "members",
                  ],
                  [
                    "👤",
                    "My Profile",
                    "Manage your profile",
                    "profile",
                  ],
                ].map(
                  (item) => (
                    <button
                      key={
                        item[1]
                      }
                      onClick={() =>
                        navigate(
                          item[3] as Section
                        )
                      }
                      style={{
                        textAlign:
                          "left",
                        padding:
                          "18px",
                        border:
                          "1px solid rgba(255,255,255,.1)",
                        borderRadius:
                          "16px",
                        background:
                          "rgba(255,255,255,.07)",
                        color:
                          "#fff",
                        cursor:
                          "pointer",
                      }}
                    >
                      <div
                        style={{
                          fontSize:
                            "27px",
                        }}
                      >
                        {item[0]}
                      </div>

                      <b
                        style={{
                          display:
                            "block",
                          marginTop:
                            "10px",
                        }}
                      >
                        {item[1]}
                      </b>

                      <small
                        style={{
                          opacity:
                            0.65,
                        }}
                      >
                        {item[2]}
                      </small>
                    </button>
                  )
                )}
              </div>

              <div
                style={{
                  marginTop:
                    "18px",
                  padding:
                    "16px",
                  borderRadius:
                    "15px",
                  background:
                    "rgba(255,255,255,.05)",
                }}
              >
                Signed in as{" "}
                <b>
                  {user.email}
                </b>
              </div>
            </div>
          )}

          {/* MESSAGES */}
          {section === "messages" && (
            <div>
              <PageTitle
                icon="💬"
                title="Messages"
                subtitle="Public conversation and private chats."
              />

              {selectedMember &&
              conversationId ? (
                <PrivateChat
                  selectedMember={
                    selectedMember
                  }
                  conversationId={
                    conversationId
                  }
                  privateMessages={
                    privateMessages
                  }
                  privateText={
                    privateText
                  }
                  setPrivateText={
                    setPrivateText
                  }
                  privateFile={
                    privateFile
                  }
                  setPrivateFile={
                    setPrivateFile
                  }
                  privateLoading={
                    privateLoading
                  }
                  sending={sending}
                  user={user}
                  onlineUsers={
                    onlineUsers
                  }
                  closePrivateChat={
                    closePrivateChat
                  }
                  sendPrivateMessage={
                    sendPrivateMessage
                  }
                  deletePrivateMessage={
                    deletePrivateMessage
                  }
                  openPrivateFile={
                    openPrivateFile
                  }
                  downloadPrivateFile={
                    downloadPrivateFile
                  }
                />
              ) : (
                <>
                  <div
                    style={{
                      display:
                        "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "center",
                      marginBottom:
                        "10px",
                    }}
                  >
                    <h3>
                      Public Chat
                    </h3>

                    <button
                      onClick={() =>
                        navigate(
                          "members"
                        )
                      }
                    >
                      👥 Find Member
                    </button>
                  </div>

                  <PublicMessages
                    messages={
                      messages
                    }
                    openFile={
                      openFile
                    }
                    downloadFile={
                      downloadFile
                    }
                  />

                  {file && (
                    <div
                      style={{
                        padding:
                          "8px",
                        marginTop:
                          "8px",
                        borderRadius:
                          "8px",
                        background:
                          "rgba(255,255,255,.08)",
                      }}
                    >
                      📎{" "}
                      {file.name}

                      <button
                        type="button"
                        onClick={() =>
                          setFile(
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

                  <Composer
                    text={text}
                    setText={
                      setText
                    }
                    file={file}
                    setFile={
                      setFile
                    }
                    sending={
                      sending
                    }
                    placeholder="Message Academic Hunters…"
                    onSend={
                      send
                    }
                  />
                </>
              )}
            </div>
          )}

          {/* AI */}
          {section === "ai" && (
            <div>
              <PageTitle
                icon="✨"
                title="Academic Hunters AI"
                subtitle="Ask questions and get AI assistance."
              />

              <PublicMessages
                messages={
                  messages.filter(
                    (m) =>
                      m.sender ===
                      "Academic Hunters AI"
                  )
                }
                openFile={
                  openFile
                }
                downloadFile={
                  downloadFile
                }
              />

              <Composer
                text={text}
                setText={
                  setText
                }
                file={null}
                setFile={
                  setFile
                }
                sending={
                  sending
                }
                placeholder="Ask Academic Hunters AI…"
                onSend={
                  send
                }
                hideFile
              />
            </div>
          )}

          {/* MEMBERS */}
          {section === "members" && (
            <div>
              <PageTitle
                icon="👥"
                title="Members"
                subtitle={`${online} members online`}
              />

              <input
                type="search"
                value={
                  memberSearch
                }
                onChange={(e) =>
                  setMemberSearch(
                    e.target.value
                  )
                }
                placeholder="🔎 Search members..."
                style={{
                  width:
                    "100%",
                  padding:
                    "13px",
                  boxSizing:
                    "border-box",
                  borderRadius:
                    "12px",
                  border:
                    "1px solid rgba(255,255,255,.15)",
                  background:
                    "rgba(255,255,255,.07)",
                  color:
                    "#fff",
                  marginBottom:
                    "15px",
                }}
              />

              {filteredMembers.length ===
              0 ? (
                <div
                  style={{
                    padding:
                      "20px",
                    borderRadius:
                      "15px",
                    background:
                      "rgba(255,255,255,.07)",
                  }}
                >
                  {memberSearch.trim()
                    ? "No members found."
                    : "No other members available."}
                </div>
              ) : (
                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(250px,1fr))",
                    gap:
                      "12px",
                  }}
                >
                  {filteredMembers.map(
                    (m) => (
                      <MemberCard
                        key={
                          m.id
                        }
                        member={
                          m
                        }
                        online={
                          Boolean(
                            onlineUsers[
                              m.id
                            ]
                          )
                        }
                        calling={
                          callingMember ===
                          m.id
                        }
                        busy={
                          Boolean(
                            callingMember
                          ) ||
                          Boolean(
                            call
                          )
                        }
                        privateLoading={
                          privateLoading
                        }
                        onChat={() =>
                          void openPrivateChat(
                            m
                          )
                        }
                        onVoice={() =>
                          void startMemberCall(
                            m,
                            false
                          )
                        }
                        onVideo={() =>
                          void startMemberCall(
                            m,
                            true
                          )
                        }
                      />
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* PROFILE */}
          {section === "profile" && (
            <div>
              <PageTitle
                icon="👤"
                title="My Profile"
                subtitle="Manage your Academic Hunters profile."
              />

              <div
                style={{
                  maxWidth:
                    "650px",
                  padding:
                    "20px",
                  borderRadius:
                    "18px",
                  background:
                    "rgba(255,255,255,.07)",
                  border:
                    "1px solid rgba(255,255,255,.1)",
                }}
              >
                <div
                  style={{
                    display:
                      "flex",
                    gap:
                      "15px",
                    alignItems:
                      "center",
                    flexWrap:
                      "wrap",
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
                          "75px",
                        height:
                          "75px",
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
                          "75px",
                        height:
                          "75px",
                        borderRadius:
                          "50%",
                        display:
                          "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                        background:
                          "rgba(255,255,255,.12)",
                        fontSize:
                          "32px",
                      }}
                    >
                      👤
                    </div>
                  )}

                  <div>
                    <b>
                      {user.email}
                    </b>

                    <div
                      style={{
                        opacity:
                          0.65,
                        marginTop:
                          "4px",
                      }}
                    >
                      Academic Hunters member
                    </div>
                  </div>
                </div>

                <label
                  style={{
                    display:
                      "block",
                    marginTop:
                      "20px",
                    marginBottom:
                      "7px",
                  }}
                >
                  Display name
                </label>

                <input
                  value={
                    displayName
                  }
                  onChange={(e) =>
                    setDisplayName(
                      e.target.value
                    )
                  }
                  placeholder="Your display name"
                  maxLength={60}
                  style={{
                    width:
                      "100%",
                    boxSizing:
                      "border-box",
                    padding:
                      "12px",
                    borderRadius:
                      "10px",
                  }}
                />

                <label
                  style={{
                    display:
                      "block",
                    marginTop:
                      "14px",
                    marginBottom:
                      "7px",
                  }}
                >
                  Profile picture
                </label>

                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    setProfileFile(
                      e.target
                        .files?.[0] ||
                      null
                    )
                  }
                />

                <div
                  style={{
                    display:
                      "flex",
                    gap:
                      "10px",
                    flexWrap:
                      "wrap",
                    marginTop:
                      "18px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      void saveProfile()
                    }
                    disabled={
                      savingProfile
                    }
                  >
                    {savingProfile
                      ? "Saving..."
                      : "💾 Save Profile"}
                  </button>

                  <button
                    type="button"
                    onClick={
                      enableNotifications
                    }
                  >
                    {notificationPermission ===
                    "granted"
                      ? "🔔 Notifications On"
                      : "🔔 Enable Notifications"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* INCOMING CALL */}
      {incomingCall && (
        <div
          style={{
            position:
              "fixed",
            left: "12px",
            right: "12px",
            bottom: "18px",
            zIndex: 9998,
            maxWidth:
              "500px",
            margin:
              "0 auto",
            padding:
              "18px",
            borderRadius:
              "18px",
            background:
              "rgba(15,20,30,.98)",
            boxShadow:
              "0 15px 50px rgba(0,0,0,.5)",
            border:
              "1px solid rgba(255,255,255,.12)",
          }}
        >
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
            }}
          >
            <button
              onClick={() =>
                void acceptCall()
              }
            >
              ✅ Accept
            </button>

            <button
              onClick={() =>
                void rejectCall()
              }
            >
              ❌ Decline
            </button>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div
          onClick={() =>
            setToast("")
          }
          style={{
            position:
              "fixed",
            top: "75px",
            right: "15px",
            left: "15px",
            zIndex: 9999,
            maxWidth:
              "550px",
            margin:
              "0 auto",
            padding:
              "13px 16px",
            borderRadius:
              "12px",
            background:
              "rgba(0,0,0,.9)",
            color:
              "#fff",
            textAlign:
              "center",
            boxShadow:
              "0 8px 30px rgba(0,0,0,.35)",
            cursor:
              "pointer",
          }}
        >
          {toast}
        </div>
      )}

      {/* CALL WINDOW */}
      {call && (
        <Call
          room={call.room}
          video={call.video}
          initiator={
            call.initiator
          }
          invitationId={
            call.invitationId
          }
          onClose={
            closeCall
          }
        />
      )}
    </main>
  );
}

/*
 * PAGE TITLE
 */
function PageTitle({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        marginBottom:
          "20px",
      }}
    >
      <div
        style={{
          fontSize:
            "12px",
          opacity:
            0.55,
          fontWeight:
            800,
          letterSpacing:
            "1px",
        }}
      >
        ACADEMIC HUNTERS
      </div>

      <h1
        style={{
          margin:
            "5px 0",
          fontSize:
            "28px",
        }}
      >
        {icon} {title}
      </h1>

      <p
        style={{
          margin:
            0,
          opacity:
            0.65,
        }}
      >
        {subtitle}
      </p>
    </div>
  );
}

/*
 * PUBLIC MESSAGES
 */
function PublicMessages({
  messages,
  openFile,
  downloadFile,
}: {
  messages: any[];
  openFile: (
    path: string
  ) => Promise<void>;
  downloadFile: (
    path: string,
    name: string
  ) => Promise<void>;
}) {
  return (
    <section
      style={{
        maxHeight:
          "55vh",
        overflowY:
          "auto",
        padding:
          "5px",
      }}
    >
      {messages.length ===
      0 ? (
        <div
          style={{
            padding:
              "25px",
            textAlign:
              "center",
            opacity:
              0.6,
          }}
        >
          No messages yet.
        </div>
      ) : (
        messages.map(
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
                key={
                  m.id || i
                }
                style={{
                  padding:
                    "13px",
                  marginBottom:
                    "9px",
                  borderRadius:
                    "13px",
                  background:
                    m.sender ===
                    "Academic Hunters AI"
                      ? "rgba(80,120,255,.16)"
                      : "rgba(255,255,255,.07)",
                }}
              >
                <b>
                  {m.sender ||
                    "Member"}
                </b>

                <p
                  style={{
                    whiteSpace:
                      "pre-wrap",
                    overflowWrap:
                      "anywhere",
                    margin:
                      "7px 0",
                  }}
                >
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
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        void openFile(
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
                        void downloadFile(
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
                        0.5,
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
        )
      )}
    </section>
  );
}

/*
 * COMPOSER
 */
function Composer({
  text,
  setText,
  file,
  setFile,
  sending,
  placeholder,
  onSend,
  hideFile = false,
}: {
  text: string;
  setText: (
    value: string
  ) => void;
  file: File | null;
  setFile: (
    value: File | null
  ) => void;
  sending: boolean;
  placeholder: string;
  onSend: () => void;
  hideFile?: boolean;
}) {
  return (
    <div
      style={{
        marginTop:
          "12px",
        padding:
          "9px",
        display:
          "flex",
        gap:
          "8px",
        alignItems:
          "center",
        background:
          "rgba(255,255,255,.07)",
        borderRadius:
          "14px",
      }}
    >
      {!hideFile && (
        <label
          style={{
            cursor:
              "pointer",
            fontSize:
              "20px",
          }}
        >
          📎
          <input
            type="file"
            style={{
              display:
                "none",
            }}
            onChange={(e) =>
              setFile(
                e.target
                  .files?.[0] ||
                null
              )
            }
          />
        </label>
      )}

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
            !e.shiftKey &&
            !sending
          ) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={
          placeholder
        }
        maxLength={5000}
        style={{
          flex: 1,
          minWidth: 0,
          padding:
            "12px",
          borderRadius:
            "10px",
          border:
            "1px solid rgba(255,255,255,.1)",
        }}
      />

      <button
        onClick={
          onSend
        }
        disabled={
          sending
        }
      >
        {sending
          ? "..."
          : "Send"}
      </button>

      {file && (
        <button
          type="button"
          onClick={() =>
            setFile(null)
          }
          title="Remove file"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/*
 * MEMBER CARD
 */
function MemberCard({
  member,
  online,
  calling,
  busy,
  privateLoading,
  onChat,
  onVoice,
  onVideo,
}: {
  member: Member;
  online: boolean;
  calling: boolean;
  busy: boolean;
  privateLoading: boolean;
  onChat: () => void;
  onVoice: () => void;
  onVideo: () => void;
}) {
  return (
    <div
      style={{
        padding:
          "15px",
        borderRadius:
          "15px",
        background:
          "rgba(255,255,255,.07)",
        border:
          "1px solid rgba(255,255,255,.08)",
      }}
    >
      <div
        style={{
          display:
            "flex",
          gap:
            "11px",
          alignItems:
            "center",
        }}
      >
        {member.avatar_url ? (
          <img
            src={
              member.avatar_url
            }
            alt=""
            style={{
              width:
                "48px",
              height:
                "48px",
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
                "48px",
              height:
                "48px",
              borderRadius:
                "50%",
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              background:
                "rgba(255,255,255,.12)",
              fontSize:
                "22px",
            }}
          >
            👤
          </div>
        )}

        <div>
          <div>
            <span
              style={{
                color:
                  online
                    ? "#31d158"
                    : "#888",
              }}
            >
              ●
            </span>{" "}
            <b>
              {member.display_name ||
                "Academic Hunters member"}
            </b>
          </div>

          <small
            style={{
              opacity:
                0.55,
            }}
          >
            {online
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
            "7px",
          flexWrap:
            "wrap",
          marginTop:
            "12px",
        }}
      >
        <button
          onClick={
            onChat
          }
          disabled={
            privateLoading
          }
        >
          💬 Chat
        </button>

        <button
          onClick={
            onVoice
          }
          disabled={
            busy
          }
        >
          {calling
            ? "Calling..."
            : "📞 Voice"}
        </button>

        <button
          onClick={
            onVideo
          }
          disabled={
            busy
          }
        >
          🎥 Video
        </button>
      </div>
    </div>
  );
}

/*
 * PRIVATE CHAT
 */
function PrivateChat({
  selectedMember,
  privateMessages,
  privateText,
  setPrivateText,
  privateFile,
  setPrivateFile,
  privateLoading,
  sending,
  user,
  onlineUsers,
  closePrivateChat,
  sendPrivateMessage,
  deletePrivateMessage,
  openPrivateFile,
  downloadPrivateFile,
}: {
  selectedMember: Member;
  conversationId: string;
  privateMessages: PrivateMessage[];
  privateText: string;
  setPrivateText: (
    value: string
  ) => void;
  privateFile: File | null;
  setPrivateFile: (
    value: File | null
  ) => void;
  privateLoading: boolean;
  sending: boolean;
  user: any;
  onlineUsers: Record<
    string,
    boolean
  >;
  closePrivateChat: () => void;
  sendPrivateMessage: () => Promise<void>;
  deletePrivateMessage: (
    id: string,
    filePath?: string | null
  ) => Promise<void>;
  openPrivateFile: (
    path: string
  ) => Promise<void>;
  downloadPrivateFile: (
    path: string,
    name: string
  ) => Promise<void>;
}) {
  return (
    <section
      style={{
        borderRadius:
          "18px",
        background:
          "rgba(255,255,255,.07)",
        border:
          "1px solid rgba(255,255,255,.1)",
        overflow:
          "hidden",
      }}
    >
      <div
        style={{
          padding:
            "15px",
          display:
            "flex",
          justifyContent:
            "space-between",
          alignItems:
            "center",
          borderBottom:
            "1px solid rgba(255,255,255,.08)",
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
            <span
              style={{
                color:
                  onlineUsers[
                    selectedMember.id
                  ]
                    ? "#31d158"
                    : "#888",
              }}
            >
              ●
            </span>{" "}
            {selectedMember.display_name ||
              "Academic Hunters member"}
          </div>
        </div>

        <button
          onClick={
            closePrivateChat
          }
        >
          ✕
        </button>
      </div>

      <div
        style={{
          height:
            "55vh",
          overflowY:
            "auto",
          padding:
            "12px",
        }}
      >
        {privateLoading ? (
          <p>
            Loading private messages...
          </p>
        ) : privateMessages.length ===
          0 ? (
          <p
            style={{
              opacity:
                0.6,
            }}
          >
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
                    "11px",
                  marginBottom:
                    "8px",
                  borderRadius:
                    "11px",
                  background:
                    m.sender_id ===
                    user?.id
                      ? "rgba(0,128,105,.25)"
                      : "rgba(255,255,255,.09)",
                }}
              >
                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
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
                      onClick={() =>
                        void deletePrivateMessage(
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
                    overflowWrap:
                      "anywhere",
                  }}
                >
                  {m.content}
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
                    }}
                  >
                    <button
                      onClick={() =>
                        void openPrivateFile(
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
                      onClick={() =>
                        void downloadPrivateFile(
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
                      0.55,
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

      {privateFile && (
        <div
          style={{
            padding:
              "8px 12px",
            background:
              "rgba(255,255,255,.05)",
          }}
        >
          📎{" "}
          {privateFile.name}

          <button
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
          padding:
            "10px",
        }}
      >
        <label
          style={{
            cursor:
              "pointer",
            padding:
              "10px",
          }}
        >
          📎

          <input
            type="file"
            style={{
              display:
                "none",
            }}
            onChange={(e) =>
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
          onChange={(e) =>
            setPrivateText(
              e.target.value
            )
          }
          onKeyDown={(e) => {
            if (
              e.key ===
                "Enter" &&
              !e.shiftKey &&
              !sending
            ) {
              e.preventDefault();
              void sendPrivateMessage();
            }
          }}
          placeholder="Write a private message..."
          maxLength={5000}
          style={{
            flex:
              1,
            minWidth:
              0,
            padding:
              "11px",
            borderRadius:
              "10px",
          }}
        />

        <button
          onClick={() =>
            void sendPrivateMessage()
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
  );
}
