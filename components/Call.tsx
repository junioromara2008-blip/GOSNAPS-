"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type CallProps = {
  room: string;
  video: boolean;
  initiator?: boolean;
  invitationId?: string;
  onClose: () => void;
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

  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionReady = useRef(false);
  const ended = useRef(false);
  const reconnecting = useRef(false);
  const statsTimer = useRef<any>(null);

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);

  const [status, setStatus] = useState("Starting call…");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(!video);
  const [connectionInfo, setConnectionInfo] = useState("");

  useEffect(() => {
    let active = true;

    async function flushIce(connection: RTCPeerConnection) {
      if (!remoteDescriptionReady.current) return;

      while (pendingIce.current.length > 0) {
        const candidate = pendingIce.current.shift();

        if (!candidate) continue;

        try {
          await connection.addIceCandidate(candidate);
        } catch (error) {
          console.warn("ICE candidate failed:", error);
        }
      }
    }

    async function sendSignal(event: string, payload: any = {}) {
      if (!channel.current) return;

      try {
        await channel.current.send({
          type: "broadcast",
          event,
          payload,
        });
      } catch (error) {
        console.warn("Call signal failed:", error);
      }
    }

    async function restartIce(connection: RTCPeerConnection) {
      if (
        ended.current ||
        !initiator ||
        reconnecting.current
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

        await sendSignal("offer", {
          type: offer.type,
          sdp: offer.sdp,
          iceRestart: true,
        });
      } catch (error) {
        console.error("ICE restart failed:", error);
        setStatus("Connection recovery failed.");
      } finally {
        reconnecting.current = false;
      }
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Your browser does not support microphone/camera access."
          );
        }

        const stream =
          await navigator.mediaDevices.getUserMedia({
            audio: true,
            video,
          });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStream.current = stream;

        if (localVideo.current) {
          localVideo.current.srcObject = stream;
        }

        const connection = new RTCPeerConnection({
          iceServers: [
            {
              urls: "stun:stun.l.google.com:19302",
            },
            {
              urls: "stun:stun1.l.google.com:19302",
            },

            /*
             * Optional TURN support.
             *
             * Add these environment variables later:
             *
             * NEXT_PUBLIC_TURN_URL
             * NEXT_PUBLIC_TURN_USERNAME
             * NEXT_PUBLIC_TURN_CREDENTIAL
             *
             * A TURN server is recommended for users
             * behind restrictive networks.
             */
            ...(process.env.NEXT_PUBLIC_TURN_URL
              ? [
                  {
                    urls:
                      process.env
                        .NEXT_PUBLIC_TURN_URL,
                    username:
                      process.env
                        .NEXT_PUBLIC_TURN_USERNAME,
                    credential:
                      process.env
                        .NEXT_PUBLIC_TURN_CREDENTIAL,
                  },
                ]
              : []),
          ],
        });

        pc.current = connection;

        stream.getTracks().forEach((track) => {
          connection.addTrack(track, stream);
        });

        connection.ontrack = (event) => {
          const remoteStream = event.streams?.[0];

          if (
            remoteStream &&
            remoteVideo.current
          ) {
            remoteVideo.current.srcObject =
              remoteStream;

            remoteVideo.current
              .play()
              .catch(() => {});
          }
        };

        connection.onicecandidate = (event) => {
          if (event.candidate) {
            sendSignal("ice", event.candidate);
          }
        };

        connection.oniceconnectionstatechange = () => {
          const state =
            connection.iceConnectionState;

          if (
            state === "checking"
          ) {
            setStatus("Connecting…");
          }

          if (
            state === "connected" ||
            state === "completed"
          ) {
            setStatus("Connected");
          }

          if (
            state === "disconnected"
          ) {
            setStatus("Connection interrupted…");

            setTimeout(() => {
              if (
                connection.iceConnectionState ===
                "disconnected"
              ) {
                restartIce(connection);
              }
            }, 1500);
          }

          if (
            state === "failed"
          ) {
            setStatus("Recovering connection…");
            restartIce(connection);
          }

          if (
            state === "closed"
          ) {
            setStatus("Call ended");
          }
        };

        connection.onconnectionstatechange = () => {
          const state =
            connection.connectionState;

          if (state === "connected") {
            setStatus("Connected");
          }

          if (state === "connecting") {
            setStatus("Connecting…");
          }

          if (state === "disconnected") {
            setStatus("Connection interrupted…");
          }

          if (state === "failed") {
            setStatus("Connection failed — recovering…");
            restartIce(connection);
          }

          if (state === "closed") {
            setStatus("Call ended");
          }
        };

        channel.current =
          sb.channel(`call-room:${room}`);

        channel.current.on(
          "broadcast",
          { event: "offer" },
          async ({ payload }: any) => {
            if (ended.current) return;

            try {
              /*
               * The caller can send another offer
               * during ICE recovery.
               */
              await connection.setRemoteDescription(
                payload
              );

              remoteDescriptionReady.current = true;

              await flushIce(connection);

              if (!initiator) {
                const answer =
                  await connection.createAnswer();

                await connection.setLocalDescription(
                  answer
                );

                await sendSignal("answer", {
                  type: answer.type,
                  sdp: answer.sdp,
                });

                setStatus("Connected");
              }
            } catch (error) {
              console.error(
                "Offer handling failed:",
                error
              );

              setStatus(
                "Could not establish the call."
              );
            }
          }
        );

        channel.current.on(
          "broadcast",
          { event: "answer" },
          async ({ payload }: any) => {
            if (
              ended.current ||
              !initiator
            ) {
              return;
            }

            try {
              await connection.setRemoteDescription(
                payload
              );

              remoteDescriptionReady.current = true;

              await flushIce(connection);

              setStatus("Connected");
            } catch (error) {
              console.error(
                "Answer handling failed:",
                error
              );

              setStatus(
                "Connection failed."
              );
            }
          }
        );

        channel.current.on(
          "broadcast",
          { event: "ice" },
          async ({ payload }: any) => {
            if (ended.current) return;

            try {
              if (
                !remoteDescriptionReady.current
              ) {
                pendingIce.current.push(
                  payload
                );
                return;
              }

              await connection.addIceCandidate(
                payload
              );
            } catch (error) {
              console.warn(
                "ICE candidate failed:",
                error
              );
            }
          }
        );

        channel.current.on(
          "broadcast",
          { event: "hangup" },
          () => {
            if (ended.current) return;

            ended.current = true;
            setStatus("Call ended by member.");

            localStream.current
              ?.getTracks()
              .forEach((track) =>
                track.stop()
              );

            connection.close();

            setTimeout(() => {
              onClose();
            }, 250);
          }
        );

        channel.current.on(
          "broadcast",
          { event: "busy" },
          () => {
            if (ended.current) return;

            setStatus("Member is busy.");
          }
        );

        const subscribeResult =
          channel.current.subscribe(
            async (state: string) => {
              if (state !== "SUBSCRIBED") {
                return;
              }

              if (initiator) {
                setStatus("Calling…");

                const offer =
                  await connection.createOffer();

                await connection.setLocalDescription(
                  offer
                );

                await sendSignal("offer", {
                  type: offer.type,
                  sdp: offer.sdp,
                });
              } else {
                setStatus("Connecting…");
              }
            }
          );

        void subscribeResult;

        /*
         * Connection statistics.
         */
        statsTimer.current = setInterval(
          async () => {
            if (
              !pc.current ||
              ended.current
            ) {
              return;
            }

            try {
              const stats =
                await pc.current.getStats();

              let packetsLost = 0;
              let packetsReceived = 0;

              stats.forEach((report) => {
                if (
                  report.type ===
                  "inbound-rtp"
                ) {
                  packetsLost +=
                    report.packetsLost || 0;

                  packetsReceived +=
                    report.packetsReceived || 0;
                }
              });

              if (
                packetsReceived > 0
              ) {
                const loss =
                  packetsLost /
                  (packetsLost +
                    packetsReceived);

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
          },
          5000
        );
      } catch (error: any) {
        console.error(
          "Call error:",
          error
        );

        setStatus(
          error?.message ||
            "Microphone/camera permission failed."
        );
      }
    }

    start();

    return () => {
      active = false;
      ended.current = true;

      if (statsTimer.current) {
        clearInterval(statsTimer.current);
      }

      localStream.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        );

      pc.current?.close();

      if (channel.current) {
        sb.removeChannel(
          channel.current
        );
      }

      pendingIce.current = [];
    };
  }, [
    room,
    video,
    initiator,
    sb,
    onClose,
  ]);

  function toggleMute() {
    const stream =
      localStream.current;

    if (!stream) return;

    stream
      .getAudioTracks()
      .forEach(
        (track) => {
          track.enabled =
            !track.enabled;
          setMuted(!track.enabled);
        }
      );
  }

  function toggleCamera() {
    const stream =
      localStream.current;

    if (!stream || !video) return;

    stream
      .getVideoTracks()
      .forEach(
        (track) => {
          track.enabled =
            !track.enabled;
          setCameraOff(!track.enabled);
        }
      );
  }

  async function endCall() {
    if (ended.current) {
      onClose();
      return;
    }

    ended.current = true;

    try {
      await channel.current?.send({
        type: "broadcast",
        event: "hangup",
        payload: {
          invitationId,
        },
      });
    } catch {
      // The other participant may already be gone.
    }

    localStream.current
      ?.getTracks()
      .forEach((track) =>
        track.stop()
      );

    pc.current?.close();

    if (statsTimer.current) {
      clearInterval(statsTimer.current);
    }

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
        padding: "12px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="callhead"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
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
        <button onClick={toggleMute}>
          {muted
            ? "🔇 Unmute"
            : "🎙️ Mute"}
        </button>

        {video && (
          <button
            onClick={toggleCamera}
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
          }}
        >
          ☎️ End call
        </button>
      </div>
    </div>
  );
}
