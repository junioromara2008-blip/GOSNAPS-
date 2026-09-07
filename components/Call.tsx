"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type CallProps = {
  room: string;
  video: boolean;
  initiator?: boolean;
  invitationId?: string;
  onClose: () => void;
};

type SignalPayload = {
  type?: RTCSdpType;
  sdp?: string | null;
  candidate?: RTCIceCandidateInit;
  invitationId?: string;
};

export default function Call({
  room,
  video,
  initiator = true,
  invitationId,
  onClose,
}: CallProps) {
  const sb = useRef(getSupabase()).current;

  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<any>(null);
  const localStream = useRef<MediaStream | null>(null);

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);

  const pendingIce = useRef<RTCIceCandidateInit[]>([]);

  const remoteDescriptionReady = useRef(false);
  const ended = useRef(false);
  const subscribed = useRef(false);
  const peerReady = useRef(false);
  const offerSent = useRef(false);
  const answerReceived = useRef(false);
  const processingOffer = useRef(false);
  const reconnecting = useRef(false);

  const offerRetryTimer = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const statsTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState("Starting call…");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(!video);
  const [connectionInfo, setConnectionInfo] = useState("");

  const safeClose = useCallback(() => {
    if (ended.current) {
      onClose();
      return;
    }

    ended.current = true;

    if (offerRetryTimer.current) {
      clearInterval(offerRetryTimer.current);
      offerRetryTimer.current = null;
    }

    if (statsTimer.current) {
      clearInterval(statsTimer.current);
      statsTimer.current = null;
    }

    localStream.current?.getTracks().forEach((track) => {
      track.stop();
    });

    localStream.current = null;

    try {
      pc.current?.close();
    } catch {
      // Already closed.
    }

    pc.current = null;

    if (channel.current) {
      try {
        sb.removeChannel(channel.current);
      } catch {
        // Already removed.
      }
    }

    channel.current = null;

    onClose();
  }, [onClose, sb]);

  useEffect(() => {
    let active = true;

    async function sendSignal(event: string, payload: SignalPayload = {}) {
      if (!channel.current || ended.current) return;

      try {
        await channel.current.send({
          type: "broadcast",
          event,
          payload,
        });
      } catch (error) {
        console.warn(`Call signal "${event}" failed:`, error);
      }
    }

    async function flushIce(connection: RTCPeerConnection) {
      if (!remoteDescriptionReady.current) return;

      while (pendingIce.current.length > 0) {
        const candidate = pendingIce.current.shift();

        if (!candidate) continue;

        try {
          await connection.addIceCandidate(candidate);
        } catch (error) {
          console.warn("Queued ICE candidate failed:", error);
        }
      }
    }

    async function createAndSendOffer(connection: RTCPeerConnection) {
      if (
        ended.current ||
        !initiator ||
        !subscribed.current ||
        !peerReady.current
      ) {
        return;
      }

      if (
        connection.signalingState !== "stable" &&
        !answerReceived.current
      ) {
        return;
      }

      try {
        const offer = await connection.createOffer();

        if (ended.current) return;

        await connection.setLocalDescription(offer);

        const localDescription = connection.localDescription;

        if (!localDescription) return;

        offerSent.current = true;

        await sendSignal("offer", {
          type: localDescription.type,
          sdp: localDescription.sdp,
          invitationId,
        });

        setStatus("Calling…");
      } catch (error) {
        console.error("Offer creation failed:", error);
        setStatus("Could not start the call.");
      }
    }

    async function restartIce(connection: RTCPeerConnection) {
      if (
        ended.current ||
        !initiator ||
        reconnecting.current ||
        !peerReady.current
      ) {
        return;
      }

      reconnecting.current = true;

      try {
        setStatus("Reconnecting…");

        const offer = await connection.createOffer({
          iceRestart: true,
        });

        await connection.setLocalDescription(offer);

        const localDescription = connection.localDescription;

        if (!localDescription) return;

        offerSent.current = true;
        answerReceived.current = false;

        await sendSignal("offer", {
          type: localDescription.type,
          sdp: localDescription.sdp,
          invitationId,
        });
      } catch (error) {
        console.error("ICE restart failed:", error);
        setStatus("Connection recovery failed.");
      } finally {
        reconnecting.current = false;
      }
    }

    async function start() {
      let connection: RTCPeerConnection | null = null;

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Your browser does not support microphone/camera access."
          );
        }

        /*
         * Request only the devices needed by this call.
         */
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: video
            ? {
                facingMode: "user",
              }
            : false,
        });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStream.current = stream;

        if (localVideo.current) {
          localVideo.current.srcObject = stream;

          try {
            await localVideo.current.play();
          } catch {
            // Mobile browsers may require user interaction.
          }
        }

        /*
         * STUN + optional TURN.
         *
         * Add these to Vercel Environment Variables when
         * you have a TURN provider:
         *
         * NEXT_PUBLIC_TURN_URL
         * NEXT_PUBLIC_TURN_USERNAME
         * NEXT_PUBLIC_TURN_CREDENTIAL
         */
        const iceServers: RTCIceServer[] = [
          {
            urls: "stun:stun.l.google.com:19302",
          },
          {
            urls: "stun:stun1.l.google.com:19302",
          },
        ];

        const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
        const turnUsername =
          process.env.NEXT_PUBLIC_TURN_USERNAME;
        const turnCredential =
          process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

        if (turnUrl && turnUsername && turnCredential) {
          iceServers.push({
            urls: turnUrl,
            username: turnUsername,
            credential: turnCredential,
          });
        }

        connection = new RTCPeerConnection({
          iceServers,
          iceCandidatePoolSize: 10,
        });

        pc.current = connection;

        /*
         * Add microphone/camera tracks.
         */
        stream.getTracks().forEach((track) => {
          connection?.addTrack(track, stream);
        });

        /*
         * Receive remote audio/video.
         */
        connection.ontrack = (event) => {
          if (ended.current) return;

          const remoteStream = event.streams?.[0];

          if (!remoteStream || !remoteVideo.current) {
            return;
          }

          remoteVideo.current.srcObject = remoteStream;

          remoteVideo.current
            .play()
            .catch(() => {
              // Mobile autoplay restrictions.
            });
        };

        /*
         * Send ICE candidates immediately.
         *
         * The other side queues them if its remote SDP
         * has not arrived yet.
         */
        connection.onicecandidate = (event) => {
          if (!event.candidate || ended.current) return;

          void sendSignal("ice", {
            candidate: event.candidate.toJSON(),
            invitationId,
          });
        };

        connection.onicegatheringstatechange = () => {
          if (
            connection?.iceGatheringState === "complete"
          ) {
            console.log("ICE gathering complete");
          }
        };

        connection.oniceconnectionstatechange = () => {
          if (!connection || ended.current) return;

          const state = connection.iceConnectionState;

          console.log("ICE state:", state);

          if (state === "checking") {
            setStatus("Connecting…");
          }

          if (
            state === "connected" ||
            state === "completed"
          ) {
            setStatus("Connected");
            setConnectionInfo("Connection established");
          }

          if (state === "disconnected") {
            setStatus("Connection interrupted…");
            setConnectionInfo("Trying to reconnect…");

            setTimeout(() => {
              if (
                !ended.current &&
                connection &&
                connection.iceConnectionState ===
                  "disconnected"
              ) {
                void restartIce(connection);
              }
            }, 2000);
          }

          if (state === "failed") {
            setStatus("Recovering connection…");
            setConnectionInfo("ICE connection failed");

            void restartIce(connection);
          }

          if (state === "closed") {
            setStatus("Call ended");
          }
        };

        connection.onconnectionstatechange = () => {
          if (!connection || ended.current) return;

          const state = connection.connectionState;

          console.log("Connection state:", state);

          if (state === "connecting") {
            setStatus("Connecting…");
          }

          if (state === "connected") {
            setStatus("Connected");
            setConnectionInfo("Good connection");
          }

          if (state === "disconnected") {
            setStatus("Connection interrupted…");
          }

          if (state === "failed") {
            setStatus("Connection failed — recovering…");
            void restartIce(connection);
          }

          if (state === "closed") {
            setStatus("Call ended");
          }
        };

        /*
         * Create a unique Supabase Broadcast channel
         * for this call room.
         */
        const callChannel = sb.channel(
          `call-room:${room}`,
          {
            config: {
              broadcast: {
                self: false,
              },
            },
          }
        );

        channel.current = callChannel;

        /*
         * IMPORTANT:
         *
         * The callee announces "ready" after subscribing.
         * This prevents the caller's first offer from being
         * sent before the callee is listening.
         */
        callChannel.on(
          "broadcast",
          { event: "ready" },
          async () => {
            if (ended.current) return;

            peerReady.current = true;

            if (initiator && connection) {
              setStatus("Connecting…");
              await createAndSendOffer(connection);
            }
          }
        );

        /*
         * Caller sends the offer.
         *
         * The callee can now safely receive it because it
         * has already announced itself as ready.
         */
        callChannel.on(
          "broadcast",
          { event: "offer" },
          async ({ payload }: { payload: SignalPayload }) => {
            if (
              ended.current ||
              !connection ||
              processingOffer.current
            ) {
              return;
            }

            if (
              !payload?.sdp ||
              payload.type !== "offer"
            ) {
              return;
            }

            /*
             * Only the non-initiator answers.
             */
            if (initiator) {
              return;
            }

            processingOffer.current = true;

            try {
              setStatus("Incoming call…");

              await connection.setRemoteDescription({
                type: "offer",
                sdp: payload.sdp,
              });

              remoteDescriptionReady.current = true;

              await flushIce(connection);

              const answer =
                await connection.createAnswer();

              await connection.setLocalDescription(answer);

              const localDescription =
                connection.localDescription;

              if (!localDescription) return;

              await sendSignal("answer", {
                type: localDescription.type,
                sdp: localDescription.sdp,
                invitationId,
              });

              peerReady.current = true;
              setStatus("Connecting…");
            } catch (error) {
              console.error(
                "Offer handling failed:",
                error
              );

              setStatus(
                "Could not establish the call."
              );
            } finally {
              processingOffer.current = false;
            }
          }
        );

        /*
         * Caller receives the answer.
         */
        callChannel.on(
          "broadcast",
          { event: "answer" },
          async ({ payload }: { payload: SignalPayload }) => {
            if (
              ended.current ||
              !connection ||
              !initiator
            ) {
              return;
            }

            if (
              !payload?.sdp ||
              payload.type !== "answer"
            ) {
              return;
            }

            if (answerReceived.current) {
              return;
            }

            try {
              await connection.setRemoteDescription({
                type: "answer",
                sdp: payload.sdp,
              });

              remoteDescriptionReady.current = true;
              answerReceived.current = true;

              await flushIce(connection);

              setStatus("Connected");
              setConnectionInfo("Connection established");

              /*
               * The answer arrived, so we no longer need
               * to keep retrying the offer.
               */
              if (offerRetryTimer.current) {
                clearInterval(offerRetryTimer.current);
                offerRetryTimer.current = null;
              }
            } catch (error) {
              console.error(
                "Answer handling failed:",
                error
              );

              setStatus("Connection failed.");
            }
          }
        );

        /*
         * Receive ICE candidates.
         */
        callChannel.on(
          "broadcast",
          { event: "ice" },
          async ({ payload }: { payload: SignalPayload }) => {
            if (ended.current || !connection) return;

            const candidate = payload?.candidate;

            if (!candidate) return;

            try {
              if (!remoteDescriptionReady.current) {
                pendingIce.current.push(candidate);
                return;
              }

              await connection.addIceCandidate(candidate);
            } catch (error) {
              console.warn(
                "ICE candidate failed:",
                error
              );
            }
          }
        );

        /*
         * Hang-up signal.
         */
        callChannel.on(
          "broadcast",
          { event: "hangup" },
          () => {
            if (ended.current) return;

            ended.current = true;
            setStatus("Call ended by member.");

            if (offerRetryTimer.current) {
              clearInterval(offerRetryTimer.current);
              offerRetryTimer.current = null;
            }

            localStream.current
              ?.getTracks()
              .forEach((track) => track.stop());

            try {
              connection?.close();
            } catch {
              // Already closed.
            }

            setTimeout(() => {
              onClose();
            }, 250);
          }
        );

        /*
         * Busy signal.
         */
        callChannel.on(
          "broadcast",
          { event: "busy" },
          () => {
            if (ended.current) return;

            setStatus("Member is busy.");
          }
        );

        /*
         * Subscribe to the Supabase channel.
         */
        const subscribeResult =
          callChannel.subscribe(
            async (state: string) => {
              console.log(
                "Call channel state:",
                state
              );

              if (state !== "SUBSCRIBED") {
                if (state === "CHANNEL_ERROR") {
                  setStatus(
                    "Call signaling connection failed."
                  );
                }

                return;
              }

              subscribed.current = true;

              if (ended.current) return;

              setStatus(
                initiator
                  ? "Waiting for member…"
                  : "Joining call…"
              );

              /*
               * Every participant announces that their
               * signaling channel is ready.
               */
              await sendSignal("ready", {
                invitationId,
              });

              /*
               * CALLEE:
               *
               * Send ready more than once because the
               * caller may subscribe slightly later.
               */
              if (!initiator) {
                setTimeout(() => {
                  if (!ended.current) {
                    void sendSignal("ready", {
                      invitationId,
                    });
                  }
                }, 1000);

                setTimeout(() => {
                  if (!ended.current) {
                    void sendSignal("ready", {
                      invitationId,
                    });
                  }
                }, 2500);
              }

              /*
               * CALLER:
               *
               * Start retrying the offer after the callee
               * announces itself.
               */
              if (initiator) {
                setTimeout(() => {
                  if (
                    !ended.current &&
                    peerReady.current &&
                    connection
                  ) {
                    void createAndSendOffer(connection);
                  }
                }, 500);
              }
            }
          );

        void subscribeResult;

        /*
         * Extra offer retry protection.
         *
         * If a ready/offer message is missed because of
         * timing, the caller sends the current offer again.
         */
        if (initiator) {
          offerRetryTimer.current = setInterval(() => {
            if (
              ended.current ||
              !connection ||
              !subscribed.current ||
              !peerReady.current ||
              answerReceived.current
            ) {
              return;
            }

            if (
              connection.signalingState ===
                "have-local-offer" ||
              connection.signalingState === "stable"
            ) {
              void createAndSendOffer(connection);
            }
          }, 4000);
        }

        /*
         * Optional connection statistics.
         */
        statsTimer.current = setInterval(async () => {
          if (!pc.current || ended.current) return;

          try {
            const stats = await pc.current.getStats();

            let packetsLost = 0;
            let packetsReceived = 0;

            stats.forEach((report: any) => {
              if (report.type === "inbound-rtp") {
                packetsLost +=
                  report.packetsLost || 0;

                packetsReceived +=
                  report.packetsReceived || 0;
              }
            });

            if (packetsReceived > 0) {
              const total =
                packetsLost + packetsReceived;

              const loss =
                total > 0
                  ? packetsLost / total
                  : 0;

              if (loss > 0.15) {
                setConnectionInfo(
                  "Weak connection"
                );
              } else if (loss > 0.05) {
                setConnectionInfo(
                  "Fair connection"
                );
              } else {
                setConnectionInfo(
                  "Good connection"
                );
              }
            }
          } catch {
            // Statistics are optional.
          }
        }, 5000);
      } catch (error: any) {
        console.error("Call error:", error);

        if (!active) return;

        let message =
          "Microphone/camera permission failed.";

        if (error?.name === "NotAllowedError") {
          message =
            "Microphone/camera permission was denied.";
        } else if (
          error?.name === "NotFoundError"
        ) {
          message =
            video
              ? "No camera or microphone was found."
              : "No microphone was found.";
        } else if (
          error?.name === "NotReadableError"
        ) {
          message =
            "Your microphone/camera is being used by another app.";
        } else if (error?.message) {
          message = error.message;
        }

        setStatus(message);
      }
    }

    void start();

    return () => {
      active = false;

      if (offerRetryTimer.current) {
        clearInterval(offerRetryTimer.current);
        offerRetryTimer.current = null;
      }

      if (statsTimer.current) {
        clearInterval(statsTimer.current);
        statsTimer.current = null;
      }

      localStream.current
        ?.getTracks()
        .forEach((track) => track.stop());

      localStream.current = null;

      try {
        pc.current?.close();
      } catch {
        // Already closed.
      }

      pc.current = null;

      if (channel.current) {
        try {
          sb.removeChannel(channel.current);
        } catch {
          // Already removed.
        }
      }

      channel.current = null;

      pendingIce.current = [];
      remoteDescriptionReady.current = false;
      subscribed.current = false;
      peerReady.current = false;
      offerSent.current = false;
      answerReceived.current = false;
      processingOffer.current = false;
      reconnecting.current = false;
    };
  }, [
    room,
    video,
    initiator,
    invitationId,
    onClose,
    sb,
  ]);

  function toggleMute() {
    const stream = localStream.current;

    if (!stream) return;

    const tracks = stream.getAudioTracks();

    if (tracks.length === 0) return;

    const nextEnabled = !tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });

    setMuted(!nextEnabled);
  }

  function toggleCamera() {
    const stream = localStream.current;

    if (!stream || !video) return;

    const tracks = stream.getVideoTracks();

    if (tracks.length === 0) return;

    const nextEnabled = !tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });

    setCameraOff(!nextEnabled);
  }

  async function endCall() {
    if (ended.current) {
      onClose();
      return;
    }

    ended.current = true;

    if (offerRetryTimer.current) {
      clearInterval(offerRetryTimer.current);
      offerRetryTimer.current = null;
    }

    if (statsTimer.current) {
      clearInterval(statsTimer.current);
      statsTimer.current = null;
    }

    try {
      await channel.current?.send({
        type: "broadcast",
        event: "hangup",
        payload: {
          invitationId,
        },
      });
    } catch {
      // Other participant may already be gone.
    }

    localStream.current
      ?.getTracks()
      .forEach((track) => track.stop());

    localStream.current = null;

    try {
      pc.current?.close();
    } catch {
      // Already closed.
    }

    pc.current = null;

    if (channel.current) {
      try {
        sb.removeChannel(channel.current);
      } catch {
        // Already removed.
      }
    }

    channel.current = null;

    onClose();
  }

  return (
    <div
      className="call"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#101010",
        color: "#fff",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        className="callhead"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          paddingBottom: "10px",
        }}
      >
        <b>
          {video
            ? "🎥 Video call"
            : "📞 Voice call"}
        </b>

        <span>{status}</span>

        {connectionInfo && (
          <small>
            • {connectionInfo}
          </small>
        )}

        <button
          onClick={endCall}
          style={{
            marginLeft: "auto",
            border: "none",
            borderRadius: "8px",
            padding: "8px 14px",
            cursor: "pointer",
          }}
        >
          End
        </button>
      </div>

      <div
        className="videos"
        style={{
          flex: 1,
          display: "flex",
          position: "relative",
          gap: "8px",
          minHeight: 0,
        }}
      >
        <video
          ref={remoteVideo}
          autoPlay
          playsInline
          controls={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "#000",
            borderRadius: "12px",
          }}
        />

        {video && (
          <video
            ref={localVideo}
            autoPlay
            muted
            playsInline
            controls={false}
            style={{
              position: "absolute",
              right: "12px",
              bottom: "12px",
              width: "30%",
              maxWidth: "180px",
              aspectRatio: "16/9",
              objectFit: "cover",
              background: "#000",
              borderRadius: "10px",
              border: "2px solid rgba(255,255,255,0.25)",
            }}
          />
        )}
      </div>

      <div
        className="call-controls"
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "10px",
          padding: "12px 0",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={toggleMute}
          style={{
            border: "none",
            borderRadius: "10px",
            padding: "10px 14px",
            cursor: "pointer",
          }}
        >
          {muted
            ? "🔇 Unmute"
            : "🎙️ Mute"}
        </button>

        {video && (
          <button
            onClick={toggleCamera}
            style={{
              border: "none",
              borderRadius: "10px",
              padding: "10px 14px",
              cursor: "pointer",
            }}
          >
            {cameraOff
              ? "📷 Camera on"
              : "🚫 Camera off"}
          </button>
        )}

        <button
          onClick={endCall}
          style={{
            background: "#d93025",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            padding: "10px 16px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          ☎️ End call
        </button>
      </div>
    </div>
  );
}
