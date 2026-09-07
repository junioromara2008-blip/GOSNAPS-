"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";
import Call from "./Call";

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

  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");

  const [members, setMembers] = useState<Member[]>(
    []
  );

  const [memberSearch, setMemberSearch] =
    useState("");

  const [messages, setMessages] = useState<any[]>(
    []
  );

  const [privateMessages, setPrivateMessages] =
    useState<PrivateMessage[]>([]);

  const [text, setText] = useState("");
  const [privateText, setPrivateText] =
    useState("");

  const [ai, setAi] = useState(false);

  const [file, setFile] = useState<File | null>(
    null
  );

  const [privateFile, setPrivateFile] =
    useState<File | null>(null);

  const [call, setCall] =
    useState<CallState | null>(null);

  const callRef = useRef<CallState | null>(null);

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

  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission | "unsupported">(
      "default"
    );

  /*
   * Keep a ref of the active call.
   */
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  /*
   * Browser notification helper.
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
      } catch {
        // Browser notifications are optional.
      }
    },
    []
  );

  /*
   * Check notification support.
   */
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

  /*
   * Enable browser notifications.
   */
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
   * PUBLIC CHAT + PRESENCE + CALLS
   */
  useEffect(() => {
    if (!user) {
      setOnline(0);
      setOnlineUsers({});
      setIncomingCall(null);
      return;
    }

    let mounted = true;

    /*
     * PUBLIC MESSAGES
     */
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

    const updatePresence =
      () => {
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
          Object.keys(users)
            .length
        );
      };

    presence
      .on(
        "presence",
        {
          event: "sync",
        },
        updatePresence
      )
      .on(
        "presence",
        {
          event: "join",
        },
        updatePresence
      )
      .on(
        "presence",
        {
          event: "leave",
        },
        updatePresence
      )
      .subscribe(
        async (status) => {
          if (
            status ===
            "SUBSCRIBED"
          ) {
            try {
              await presence.track(
                {
                  user_id:
                    user.id,
                  online_at:
                    new Date().toISOString(),
                }
              );

              updatePresence();
            } catch {
              // Presence is optional.
            }
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
            if (!mounted)
              return;

            const invitation =
              payload.new as any;

            /*
             * Only the receiver handles
             * incoming calls.
             */
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

            /*
             * Ignore expired invitations.
             */
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

              return;
            }

            /*
             * Do not replace an active call
             * with another incoming call.
             */
            if (
              callRef.current
            ) {
              await sb
                .from(
                  "call_invitations"
                )
                .update({
                  status:
                    "rejected",
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

            const incoming: IncomingCall =
              {
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

            const callMessage =
              invitation.video
                ? "Incoming video call"
                : "Incoming voice call";

            setToast(
              `${callMessage} from ${callerName}`
            );

            notifyBrowser(
              callMessage,
              `${callerName} is calling you.`
            );

            /*
             * Automatically expire the invitation
             * after its expiry time.
             */
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
                  if (
                    !mounted
                  ) {
                    return;
                  }

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
            if (!mounted)
              return;

            const invitation =
              payload.new as any;

            /*
             * Caller side.
             */
            if (
              invitation.caller_id ===
              user.id
            ) {
              if (
                invitation.status ===
                "accepted"
              ) {
                setCallingMember(
                  null
                );

                setCall({
                  room:
                    invitation.room_id,
                  video:
                    Boolean(
                      invitation.video
                    ),
                  initiator:
                    true,
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
                setCallingMember(
                  null
                );

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

            /*
             * Receiver side.
             */
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
     * GLOBAL PRIVATE MESSAGE NOTIFICATIONS
     *
     * This does not insert the message into
     * the current chat. The current-chat channel
     * handles that separately.
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
            if (!mounted)
              return;

            const incoming =
              payload.new as PrivateMessage;

            if (
              incoming.sender_id ===
              user.id
            ) {
              return;
            }

            /*
             * Don't create a browser notification
             * for the conversation currently open.
             */
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
     * NEW MEMBER NOTIFICATIONS
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
            if (!mounted)
              return;

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

            /*
             * Refresh member list.
             */
            void loadMembers();
          }
        )
        .subscribe();

    return () => {
      mounted = false;

      sb.removeChannel(msg);
      sb.removeChannel(
        presence
      );
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

    if (error) {
      return;
    }

    if (data) {
      let avatarUrl:
        | string
        | null = null;

      if (
        data.avatar_path
      ) {
        const result =
          await sb.storage
            .from(
              "gosnaps-avatars"
            )
            .createSignedUrl(
              data.avatar_path,
              3600
            );

        avatarUrl =
          result.data
            ?.signedUrl ||
          null;
      }

      const profile: Member =
        {
          ...data,
          avatar_url:
            avatarUrl,
        };

      setMyProfile(
        profile
      );

      setDisplayName(
        data.display_name ||
          ""
      );
    } else {
      /*
       * Create a profile if one does not exist.
       */
      const fallbackName =
        user.user_metadata
          ?.display_name ||
        user.email
          ?.split("@")[0] ||
        "Academic Hunters member";

      const created =
        await sb
          .from("profiles")
          .insert({
            id: user.id,
            display_name:
              fallbackName,
          });

      if (
        !created.error
      ) {
        setDisplayName(
          fallbackName
        );

        await loadMyProfile();
      }
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
        email:
          email.trim(),
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

        if (
          upload.error
        ) {
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

      /*
       * Remove previous avatar after
       * the new profile is saved.
       */
      if (
        profileFile &&
        oldAvatarPath &&
        oldAvatarPath !==
          avatarPath
      ) {
        await sb.storage
          .from(
            "gosnaps-avatars"
          )
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
      setToast(
        error.message
      );
      return;
    }

    const enriched: Member[] =
      [];

    for (
      const member of data || []
    ) {
      let avatarUrl:
        | string
        | null = null;

      if (
        member.avatar_path
      ) {
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
          result.data
            ?.signedUrl ||
          null;
      }

      enriched.push({
        ...member,
        avatar_url:
          avatarUrl,
      });
    }

    setMembers(
      enriched
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

    setPrivateLoading(
      true
    );

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
          .from(
            "conversations"
          )
          .insert({
            id,
          });

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

      /*
       * Add current user.
       */
      const firstMember =
        await sb
          .from(
            "conversation_members"
          )
          .insert({
            conversation_id:
              id,
            user_id:
              user.id,
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

      /*
       * Add selected member.
       */
      const secondMember =
        await sb
          .from(
            "conversation_members"
          )
          .insert({
            conversation_id:
              id,
            user_id:
              member.id,
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

      await loadPrivateMessages(
        id
      );

      setSelectedMember(
        member
      );

      setConversationId(
        id
      );

      setToast(
        `Private chat with ${
          member.display_name ||
          "member"
        } opened`
      );
    } finally {
      setPrivateLoading(
        false
      );
    }
  }

  /*
   * LOAD PRIVATE MESSAGES
   */
  async function loadPrivateMessages(
    id: string
  ) {
    const { data, error } =
      await sb
        .from(
          "private_messages"
        )
        .select(
          "id,conversation_id,sender_id,content,created_at,read_at,file_path,file_name,file_size,mime_type"
        )
        .eq(
          "conversation_id",
          id
        )
        .order(
          "created_at",
          {
            ascending: true,
          }
        )
        .limit(200);

    if (error) {
      setToast(
        error.message
      );
      return;
    }

    const loaded =
      (data ||
        []) as PrivateMessage[];

    /*
     * Mark unread incoming messages as read.
     */
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

      if (
        unreadIds.length
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

    setPrivateMessages(
      loaded
    );
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
             * Mark incoming message as read.
             */
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

        if (
          upload.error
        ) {
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
            file_size:
              fileSize,
            mime_type:
              mimeType,
          });

      if (error) {
        /*
         * If database insertion failed after
         * file upload, try to remove the file.
         */
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
        .from(
          "private_messages"
        )
        .delete()
        .eq(
          "id",
          id
        )
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

    setPrivateMessages(
      (old) =>
        old.filter(
          (message) =>
            message.id !==
            id
        )
    );

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

    if (
      callingMember ||
      callRef.current
    ) {
      setToast(
        "You already have a call in progress."
      );
      return;
    }

    setCallingMember(
      member.id
    );

    try {
      /*
       * Prevent duplicate outgoing invitations.
       */
      const { data: activeCall } =
        await sb
          .from(
            "call_invitations"
          )
          .select(
            "id,status,expires_at"
          )
          .eq(
            "caller_id",
            user.id
          )
          .in(
            "status",
            [
              "ringing",
              "accepted",
            ]
          )
          .limit(1)
          .maybeSingle();

      if (
        activeCall
      ) {
        setCallingMember(
          null
        );
        setToast(
          "You already have an active call."
        );
        return;
      }

      const room =
        crypto.randomUUID();

      const expiresAt =
        new Date(
          Date.now() +
            60_000
        ).toISOString();

      const {
        data: invitation,
        error,
      } = await sb
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
          expires_at:
            expiresAt,
        })
        .select(
          "id"
        )
        .single();

      if (
        error ||
        !invitation
      ) {
        setCallingMember(
          null
        );

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

      /*
       * If nobody accepts within 60 seconds,
       * cancel the outgoing invitation.
       */
      window.setTimeout(
        async () => {
          if (
            callRef.current
          ) {
            return;
          }

          const { data } =
            await sb
              .from(
                "call_invitations"
              )
              .select(
                "status"
              )
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

            setCallingMember(
              null
            );

            setToast(
              "No answer. Call invitation expired."
            );
          }
        },
        60_500
      );
    } catch (error: any) {
      setCallingMember(
        null
      );

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

    if (
      callRef.current
    ) {
      setToast(
        "You are already on a call."
      );
      return;
    }

    const accepted =
      incomingCall;

    /*
     * Verify the invitation is still valid.
     */
    const {
      data: invitation,
      error: fetchError,
    } = await sb
      .from(
        "call_invitations"
      )
      .select(
        "id,caller_id,receiver_id,room_id,video,status,expires_at"
      )
      .eq(
        "id",
        accepted.id
      )
      .eq(
        "receiver_id",
        user.id
      )
      .maybeSingle();

    if (
      fetchError ||
      !invitation
    ) {
      setIncomingCall(
        null
      );

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
      setIncomingCall(
        null
      );

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
          accepted.id
        )
        .eq(
          "status",
          "ringing"
        );

      setIncomingCall(
        null
      );

      setToast(
        "This call invitation has expired."
      );

      return;
    }

    const { error } =
      await sb
        .from(
          "call_invitations"
        )
        .update({
          status:
            "accepted",
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
      setToast(
        error.message
      );
      return;
    }

    setIncomingCall(
      null
    );

    setCall({
      room:
        accepted.room_id,
      video:
        accepted.video,
      initiator:
        false,
      invitationId:
        accepted.id,
    });

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
        .from(
          "call_invitations"
        )
        .update({
          status:
            "rejected",
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
      setToast(
        error.message
      );
      return;
    }

    setIncomingCall(
      null
    );

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
                  message:
                    q,
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
            .from(
              "gosnaps-files"
            )
            .upload(
              path,
              file
            );

        if (
          upload.error
        ) {
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

      if (
        result.error
      ) {
        if (
          attachmentPath
        ) {
          await sb.storage
            .from(
              "gosnaps-files"
            )
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
   * CLOSE PRIVATE CHAT
   */
  function closePrivateChat() {
    setSelectedMember(
      null
    );

    setConversationId(
      null
    );

    setPrivateMessages(
      []
    );

    setPrivateText("");
    setPrivateFile(null);
  }

  /*
   * CLOSE CALL
   *
   * useCallback keeps the function stable
   * while Call.tsx is mounted.
   */
  const closeCall =
    useCallback(
      async () => {
        const currentCall =
          callRef.current;

        setCall(null);
        setCallingMember(
          null
        );

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
              status:
                "ended",
              ended_at:
                now,
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
            autoComplete="email"
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
                maxLength={60}
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

            void loadMembers();

            setToast(
              "Choose a member for a voice call."
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

            void loadMembers();

            setToast(
              "Choose a member for a video call."
            );
          }}
        >
          🎥 Video
        </button>

        <button
          onClick={() =>
            void loadMembers()
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
        <div
          className="incoming-call"
          style={{
            position:
              "fixed",
            left: "12px",
            right: "12px",
            bottom: "18px",
            zIndex: 9998,
            padding:
              "16px",
            borderRadius:
              "16px",
            background:
              "rgba(20,20,20,.98)",
            boxShadow:
              "0 12px 40px rgba(0,0,0,.35)",
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
              flexWrap:
                "wrap",
            }}
          >
            <button
              type="button"
              onClick={() =>
                void acceptCall()
              }
            >
              ✅ Accept
            </button>

            <button
              type="button"
              onClick={() =>
                void rejectCall()
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
                      <div
                        style={{
                          width:
                            "42px",
                          height:
                            "42px",
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
                        void openPrivateChat(
                          m
                        )
                      }
                    >
                      💬 Chat
                    </button>

                    <button
                      type="button"
                      disabled={
                        Boolean(
                          callingMember
                        ) ||
                        Boolean(
                          call
                        )
                      }
                      onClick={() =>
                        void startMemberCall(
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
                        Boolean(
                          callingMember
                        ) ||
                        Boolean(
                          call
                        )
                      }
                      onClick={() =>
                        void startMemberCall(
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

                  <span
                    style={{
                      color:
                        onlineUsers[
                          selectedMember.id
                        ]
                          ? "#31d158"
                          : "#999",
                    }}
                  >
                    ●
                  </span>{" "}
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
                            type="button"
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
                  overflowWrap:
                    "anywhere",
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
              <label
                style={{
                  cursor:
                    "pointer",
                }}
              >
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
                }}
              />

              <button
                type="button"
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

                <p
                  style={{
                    whiteSpace:
                      "pre-wrap",
                    overflowWrap:
                      "anywhere",
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
                      marginTop:
                        "8px",
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

      {/* PUBLIC FILE PREVIEW */}
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
            overflowWrap:
              "anywhere",
          }}
        >
          📎 {file.name}

          <button
            type="button"
            onClick={() =>
              setFile(null)
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
              !e.shiftKey &&
              !sending
            ) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={
            ai
              ? "Ask Academic Hunters AI…"
              : "Message Academic Hunters…"
          }
          maxLength={5000}
        />

        <button
          onClick={() =>
            void send()
          }
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
