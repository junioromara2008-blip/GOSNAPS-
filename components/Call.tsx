"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type CallProps = {
  room: string;
  video: boolean;
  initiator?: boolean;
  onClose: () => void;
};

export default function Call({
  room,
  video,
  initiator = true,
  onClose,
}: CallProps) {
  const sb = useRef(getSupabase()).current;

  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<any>(null);
  const localStream =
    useRef<MediaStream | null>(null);

  const localVideo =
    useRef<HTMLVideoElement>(null);

  const remoteVideo =
    useRef<HTMLVideoElement>(null);

  const [status, setStatus] =
    useState("Starting call…");

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: true,
              video,
            }
          );

        if (!active) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );
          return;
        }

        localStream.current = stream;

        if (localVideo.current) {
          localVideo.current.srcObject =
            stream;
        }

        const connection =
          new RTCPeerConnection({
            iceServers: [
              {
                urls:
                  "stun:stun.l.google.com:19302",
              },
              {
                urls:
                  "stun:stun1.l.google.com:19302",
              },
            ],
          });

        pc.current = connection;

        stream
          .getTracks()
          .forEach((track) => {
            connection.addTrack(
              track,
              stream
            );
          });

        connection.ontrack = (event) => {
          if (
            remoteVideo.current &&
            event.streams[0]
          ) {
            remoteVideo.current.srcObject =
              event.streams[0];
          }
        };

        channel.current =
          sb.channel(
            `call-room:${room}`
          );

        connection.onicecandidate = (
          event
        ) => {
          if (
            event.candidate &&
            channel.current
          ) {
            channel.current.send({
              type: "broadcast",
              event: "ice",
              payload:
                event.candidate,
            });
          }
        };

        channel.current.on(
          "broadcast",
          {
            event: "offer",
          },
          async ({
            payload,
          }: any) => {
            if (initiator) return;

            try {
              await connection.setRemoteDescription(
                payload
              );

              const answer =
                await connection.createAnswer();

              await connection.setLocalDescription(
                answer
              );

              await channel.current.send({
                type: "broadcast",
                event: "answer",
                payload: answer,
              });

              setStatus(
                "Connected"
              );
            } catch (error) {
              console.error(
                error
              );

              setStatus(
                "Could not answer the call."
              );
            }
          }
        );

        channel.current.on(
          "broadcast",
          {
            event: "answer",
          },
          async ({
            payload,
          }: any) => {
            if (!initiator) return;

            try {
              await connection.setRemoteDescription(
                payload
              );

              setStatus(
                "Connected"
              );
            } catch (error) {
              console.error(
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
          {
            event: "ice",
          },
          async ({
            payload,
          }: any) => {
            try {
              await connection.addIceCandidate(
                payload
              );
            } catch {
              // Ignore late ICE candidates.
            }
          }
        );

        channel.current.subscribe(
          async (state: string) => {
            if (
              state !==
              "SUBSCRIBED"
            ) {
              return;
            }

            if (initiator) {
              setStatus(
                "Calling…"
              );

              const offer =
                await connection.createOffer();

              await connection.setLocalDescription(
                offer
              );

              await channel.current.send({
                type: "broadcast",
                event: "offer",
                payload: offer,
              });
            } else {
              setStatus(
                "Connecting…"
              );
            }
          }
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
    };
  }, [
    room,
    video,
    initiator,
    sb,
  ]);

  function endCall() {
    localStream.current
      ?.getTracks()
      .forEach((track) =>
        track.stop()
      );

    pc.current?.close();

    onClose();
  }

  return (
    <div className="call">
      <div className="callhead">
        <b>
          {video
            ? "🎥 Video call"
            : "📞 Voice call"}
        </b>

        <span>{status}</span>

        <button
          onClick={endCall}
        >
          End
        </button>
      </div>

      <div className="videos">
        <video
          ref={remoteVideo}
          autoPlay
          playsInline
        />

        <video
          ref={localVideo}
          autoPlay
          muted
          playsInline
        />
      </div>

      <div className="room">
        {status === "Connected"
          ? "Call connected"
          : "Connecting to member…"}
      </div>
    </div>
  );
}
