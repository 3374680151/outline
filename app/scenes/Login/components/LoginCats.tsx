import * as React from "react";
import styled, { keyframes } from "styled-components";

type CatState = "track" | "glance-l" | "glance-r" | "watch" | "sad" | "happy";

type CatStatus = "idle" | "watch" | "error" | "happy";

type CatConfig = {
  id: string;
  fur: string;
  furDark: string;
  ear: string;
};

const CATS: CatConfig[] = [
  { id: "golden", fur: "#f2c98a", furDark: "#d9a75f", ear: "#f7b6c2" },
  { id: "ginger", fur: "#f5a35c", furDark: "#dd7f39", ear: "#f7a8b4" },
  { id: "silver", fur: "#c3cbd9", furDark: "#98a2b4", ear: "#e8b2bc" },
  { id: "cream", fur: "#f5e3c8", furDark: "#dcc194", ear: "#f4b8c0" },
];

const CONFETTI_COLORS = [
  "#5ec8ff",
  "#8b7ff5",
  "#ffb35c",
  "#ff8a5c",
  "#7ef0c9",
  "#f4f9ff",
];

const EMAIL_SELECTORS = [
  "input[type=email]",
  "input[autocomplete=email]",
  "input[name=email]",
];

/**
 * Finds whether the given target is an email input the cats should react to.
 *
 * @param target The event target to inspect.
 * @returns True when the target is an email input.
 */
function isEmailInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement &&
    EMAIL_SELECTORS.some((selector) => target.matches(selector))
  );
}

type Props = {
  /** Overall scene status that drives the cats' mood. */
  status?: CatStatus;
};

/**
 * Four electronic cats peeking over the top edge of the login panel, drawn
 * entirely with CSS and SVG. Their pupils follow the pointer, they glance at
 * each other while an email is being typed, droop when authentication fails
 * and jump around with confetti when a sign-in link has been sent.
 *
 * @param status The current scene status.
 */
export function LoginCats({ status = "idle" }: Props) {
  const tiltRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const pupilRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const confettiLayerRef = React.useRef<HTMLDivElement | null>(null);

  const [blinking, setBlinking] = React.useState<boolean[]>([
    false,
    false,
    false,
    false,
  ]);
  const [squinting, setSquinting] = React.useState<boolean[]>([
    false,
    false,
    false,
    false,
  ]);

  const statusRef = React.useRef<CatStatus>(status);
  const typingRef = React.useRef(false);

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  React.useEffect(() => {
    if (status !== "happy") {
      return;
    }
    const layer = confettiLayerRef.current;
    if (!layer) {
      return;
    }
    layer.innerHTML = "";
    for (let i = 0; i < 64; i++) {
      const bit = document.createElement("i");
      const left = Math.random() * 100;
      const delay = Math.random() * 0.6;
      const duration = 2.1 + Math.random() * 1.6;
      const size = 5 + Math.random() * 6;
      const drift = (Math.random() - 0.5) * 140;
      const rotate = 360 + Math.random() * 720;
      const color =
        CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      bit.style.cssText = `left:${left}%;width:${size}px;height:${
        size * 0.6
      }px;background:${color};--drift:${drift}px;--rotate:${rotate}deg;animation-delay:${delay}s;animation-duration:${duration}s`;
      layer.appendChild(bit);
    }
    const cleanup = setTimeout(() => {
      layer.innerHTML = "";
    }, 4800);
    return () => clearTimeout(cleanup);
  }, [status]);

  React.useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const pointer = { x: 0, y: 0, rawX: 0, rawY: 0, active: false };
    let centers: { x: number; y: number }[] = [];

    const handlePointerMove = (event: PointerEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - cx) / cx));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY - cy) / cy));
      pointer.rawX = event.clientX;
      pointer.rawY = event.clientY;
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
    };

    const measure = () => {
      centers = tiltRefs.current.map((el) => {
        if (!el) {
          return { x: 0, y: 0 };
        }
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
    };

    const statesFor = (): CatState[] => {
      const current = statusRef.current;
      if (current === "happy") {
        return ["happy", "happy", "happy", "happy"];
      }
      if (current === "error") {
        return ["sad", "sad", "sad", "sad"];
      }
      if (current === "watch") {
        return ["watch", "watch", "watch", "watch"];
      }
      if (typingRef.current) {
        return ["glance-r", "glance-l", "track", "track"];
      }
      return ["track", "track", "track", "track"];
    };

    let rafId = 0;
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const pupils = pupilRefs.current;
      if (pupils.length < 8 || centers.length < 4) {
        return;
      }
      const states = statesFor();
      const p = pointer;
      const cx = centers.reduce((sum, c) => sum + c.x, 0) / 4;
      const cy = centers.reduce((sum, c) => sum + c.y, 0) / 4;

      for (let i = 0; i < 4; i++) {
        const state = states[i];
        const tilt = tiltRefs.current[i];
        const center = centers[i];
        if (!tilt || !center) {
          continue;
        }
        let tx: number;
        let ty: number;
        let headTilt = 0;

        switch (state) {
          case "glance-r":
          case "glance-l": {
            const other = centers[i === 0 ? 1 : 0];
            tx = other?.x ?? cx;
            ty = other?.y ?? cy;
            headTilt = state === "glance-r" ? 7 : -7;
            break;
          }
          case "watch":
            tx = cx;
            ty = cy + 300;
            break;
          case "sad":
            tx = cx;
            ty = cy + 90;
            break;
          case "happy":
            tx = cx;
            ty = cy - 320;
            break;
          default:
            if (p.active) {
              tx = p.rawX;
              ty = p.rawY;
              headTilt =
                Math.max(-8, Math.min(8, p.x * 4)) * (i % 2 === 0 ? 1 : -1);
            } else {
              tx = cx + Math.sin(now / 1400 + i * 1.7) * 150;
              ty = cy + Math.cos(now / 1900 + i * 1.3) * 50;
            }
            break;
        }

        const dx = tx - center.x;
        const dy = ty - center.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ox = (dx / dist) * Math.min(dist / 40, 1) * 3.6;
        const oy = (dy / dist) * Math.min(dist / 40, 1) * 2.8;
        const transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`;

        const leftPupil = pupilRefs.current[i * 2];
        const rightPupil = pupilRefs.current[i * 2 + 1];
        if (leftPupil) {
          leftPupil.style.transform = transform;
        }
        if (rightPupil) {
          rightPupil.style.transform = transform;
        }
        tilt.style.transform = `rotate(${headTilt.toFixed(2)}deg)`;
      }
    };

    const markTyping = () => {
      typingRef.current = true;
    };
    const clearTyping = () => {
      typingRef.current = false;
    };
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    const handleInput = () => {
      typingRef.current = true;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        typingRef.current = false;
      }, 800);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isEmailInput(event.target)) {
        markTyping();
      }
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (isEmailInput(event.target)) {
        clearTyping();
      }
    };

    const measureTimer = setInterval(measure, 1200);
    window.addEventListener("resize", measure);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("blur", handlePointerLeave);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("input", handleInput, true);
    if (!reducedMotion) {
      measure();
      rafId = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(measureTimer);
      clearTimeout(typingTimer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("input", handleInput, true);
    };
  }, []);

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const wait = (fn: () => void, delay: number) => {
      timers.push(setTimeout(fn, delay));
    };

    const setEye = (
      setter: React.Dispatch<React.SetStateAction<boolean[]>>,
      index: number,
      value: boolean
    ) => {
      setter((prev) => {
        const next = [...prev];
        next[index] = value;
        return next;
      });
    };

    const scheduleBlink = (index: number) => {
      wait(
        () => {
          setEye(setBlinking, index, true);
          wait(() => {
            setEye(setBlinking, index, false);
            scheduleBlink(index);
          }, 140);
        },
        1800 + Math.random() * 2400
      );
    };

    // All cats blink twice in unison every so often.
    const scheduleChorus = () => {
      wait(
        () => {
          for (let i = 0; i < 4; i++) {
            setEye(setBlinking, i, true);
          }
          wait(() => {
            for (let i = 0; i < 4; i++) {
              setEye(setBlinking, i, false);
            }
            wait(() => {
              for (let i = 0; i < 4; i++) {
                setEye(setBlinking, i, true);
              }
              wait(() => {
                for (let i = 0; i < 4; i++) {
                  setEye(setBlinking, i, false);
                }
                scheduleChorus();
              }, 150);
            }, 130);
          }, 150);
        },
        7000 + Math.random() * 3000
      );
    };

    // Occasionally a cat closes its eyes into a content squint.
    const scheduleSquint = (index: number) => {
      wait(
        () => {
          setEye(setSquinting, index, true);
          wait(
            () => {
              setEye(setSquinting, index, false);
              scheduleSquint(index);
            },
            900 + Math.random() * 500
          );
        },
        6000 + Math.random() * 5000
      );
    };

    for (let i = 0; i < 4; i++) {
      scheduleBlink(i);
      scheduleSquint(i);
    }
    scheduleChorus();
    return () => timers.forEach(clearTimeout);
  }, []);

  const states = (() => {
    if (status === "happy") {
      return ["happy", "happy", "happy", "happy"] as CatState[];
    }
    if (status === "error") {
      return ["sad", "sad", "sad", "sad"] as CatState[];
    }
    if (status === "watch") {
      return ["watch", "watch", "watch", "watch"] as CatState[];
    }
    return ["track", "track", "track", "track"] as CatState[];
  })();

  return (
    <Stage aria-hidden="true">
      <div className="confetti-layer" ref={confettiLayerRef} />
      <div className={status === "error" ? "chars shake" : "chars"}>
        {CATS.map((cat, i) => {
          const state = states[i];
          return (
            <div
              key={cat.id}
              className={[
                "cat",
                state,
                blinking[i] ? "blink" : undefined,
                squinting[i] ? "squint" : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                {
                  "--i": i,
                  "--fur": cat.fur,
                  "--fur-dark": cat.furDark,
                  "--ear": cat.ear,
                  "--enter-delay": `${i * 110}ms`,
                } as React.CSSProperties
              }
            >
              <div
                className="tilt"
                ref={(el) => {
                  tiltRefs.current[i] = el;
                }}
              >
                <svg className="tail" viewBox="0 0 60 90">
                  <path
                    d="M38 86 C 12 78, 8 46, 22 22"
                    fill="none"
                    stroke={cat.furDark}
                    strokeWidth={13}
                    strokeLinecap="round"
                  />
                  <path
                    d="M38 86 C 12 78, 8 46, 22 22"
                    fill="none"
                    stroke={cat.fur}
                    strokeWidth={7}
                    strokeLinecap="round"
                  />
                  <circle cx={22} cy={18} r={8} fill={cat.fur} />
                </svg>

                <div className="paw paw-l">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="paw paw-r">
                  <i />
                  <i />
                  <i />
                </div>

                <div className="head">
                  <div className="ear ear-l">
                    <i className="ear-inner" />
                  </div>
                  <div className="ear ear-r">
                    <i className="ear-inner" />
                  </div>

                  <div className="face">
                    <div className="eye">
                      <div className="sclera">
                        <div
                          className="pupil"
                          ref={(el) => {
                            pupilRefs.current[i * 2] = el;
                          }}
                        >
                          <i className="shine" />
                        </div>
                      </div>
                      <div className="lid" />
                    </div>
                    <div className="eye">
                      <div className="sclera">
                        <div
                          className="pupil"
                          ref={(el) => {
                            pupilRefs.current[i * 2 + 1] = el;
                          }}
                        >
                          <i className="shine" />
                        </div>
                      </div>
                      <div className="lid" />
                    </div>
                  </div>

                  <div className="muzzle">
                    <i className="nose" />
                    <svg className="mouth" viewBox="0 0 40 18">
                      <path
                        d="M20 4 L12 12 M20 4 L28 12 M12 12 Q16 17 20 12 Q24 17 28 12"
                        fill="none"
                        stroke="rgba(30,20,26,.55)"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>

                  <div className="cheek cheek-l" />
                  <div className="cheek cheek-r" />

                  <div className="whiskers whiskers-l">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="whiskers whiskers-r">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

const catRise = keyframes`
  from {
    opacity: 0;
    transform: translateY(52px);
  }
`;

const tailSway = keyframes`
  0%,
  100% {
    rotate: -8deg;
  }
  50% {
    rotate: 10deg;
  }
`;

const tailExcited = keyframes`
  0%,
  100% {
    rotate: -18deg;
  }
  50% {
    rotate: 22deg;
  }
`;

const catBob = keyframes`
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -4px;
  }
`;

const catJump = keyframes`
  0%,
  100% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-30px) rotate(-3deg);
  }
  55% {
    transform: translateY(0);
  }
  70% {
    transform: translateY(-11px);
  }
`;

const shake = keyframes`
  20% {
    transform: translateX(-7px);
  }
  40% {
    transform: translateX(6px);
  }
  60% {
    transform: translateX(-4px);
  }
  80% {
    transform: translateX(3px);
  }
`;

const confettiFall = keyframes`
  0% {
    transform: translate(0, -20px) rotate(0deg);
    opacity: 0;
  }
  8% {
    opacity: 0.95;
  }
  100% {
    transform: translate(var(--drift), 320px) rotate(var(--rotate));
    opacity: 0;
  }
`;

const Stage = styled.div`
  position: relative;
  width: 100%;
  display: flex;
  justify-content: center;
  pointer-events: none;
  user-select: none;

  .chars {
    display: flex;
    align-items: flex-end;
    gap: clamp(2px, 1.4vw, 14px);
  }

  .chars.shake {
    animation: ${shake} 0.5s ease;
  }

  .cat {
    position: relative;
    width: 118px;
    margin-bottom: -36px;
    transition:
      transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
      filter 0.3s ease;
    animation: ${catRise} 0.7s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    animation-delay: var(--enter-delay);
  }

  .cat.glance-r {
    transform: translateX(14px);
  }
  .cat.glance-l {
    transform: translateX(-14px);
  }
  .cat.watch {
    transform: translateY(-4px);
  }
  .cat.sad {
    transform: translateY(10%);
    filter: saturate(0.55) brightness(0.78);
  }

  .tilt {
    position: relative;
    will-change: transform;
    transform-origin: 50% 90%;
  }

  .cat.track .tilt {
    animation: ${catBob} 3.2s ease-in-out infinite;
    animation-delay: calc(var(--i) * 0.42s);
  }

  .head {
    position: relative;
    width: 108px;
    height: 96px;
    background: radial-gradient(
      circle at 50% 32%,
      var(--fur),
      var(--fur-dark) 130%
    );
    border-radius: 52% 52% 48% 48% / 58% 58% 42% 42%;
    box-shadow:
      inset 0 -8px 14px rgba(30, 18, 10, 0.12),
      inset 0 6px 10px rgba(255, 255, 255, 0.35),
      0 10px 24px rgba(2, 6, 20, 0.45);
  }

  .ear {
    position: absolute;
    top: -14px;
    width: 34px;
    height: 38px;
    background: var(--fur);
    clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
    transition: transform 0.3s ease;
    z-index: 0;
  }
  .ear-l {
    left: 8px;
    transform: rotate(-16deg);
  }
  .ear-r {
    right: 8px;
    transform: rotate(16deg);
  }
  .ear-inner {
    position: absolute;
    inset: 10px 8px 4px;
    background: var(--ear);
    clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
  }
  .cat.sad .ear-l {
    transform: rotate(-58deg) translateY(6px);
  }
  .cat.sad .ear-r {
    transform: rotate(58deg) translateY(6px);
  }
  .cat.sad .ear-inner {
    opacity: 0.4;
  }

  .face {
    position: absolute;
    top: 26px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 17px;
    z-index: 2;
  }
  .eye {
    position: relative;
    width: 25px;
    height: 25px;
  }
  .sclera {
    position: absolute;
    inset: 0;
    background: #fffdf8;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: inset 0 -2px 4px rgba(40, 24, 14, 0.18);
    transition: transform 0.18s ease;
  }
  .cat.watch .sclera {
    transform: scale(1.14);
  }
  .pupil {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 52%;
    height: 52%;
    margin: -26% 0 0 -26%;
    background: radial-gradient(circle at 50% 40%, #3d2f26 0%, #17110c 70%);
    border-radius: 50%;
    will-change: transform;
    transition: transform 0.06s linear;
  }
  .shine {
    position: absolute;
    left: 16%;
    top: 12%;
    width: 38%;
    height: 38%;
    background: rgba(255, 255, 255, 0.92);
    border-radius: 50%;
  }
  .lid {
    position: absolute;
    left: -4%;
    right: -4%;
    top: 0;
    height: 0;
    background: var(--fur);
    border-radius: 0 0 45% 45%;
    transition: height 0.13s ease;
    z-index: 2;
  }
  .cat.blink .lid {
    height: 104%;
    border-radius: 0;
  }
  .cat.sad .lid {
    height: 52%;
    border-radius: 0 0 50% 50%;
    transition: height 0.3s ease;
  }
  .cat.squint .sclera {
    transform: scaleY(0.14);
  }
  .cat.squint .cheek {
    opacity: 1;
  }

  .muzzle {
    position: absolute;
    left: 50%;
    top: 52px;
    transform: translateX(-50%);
    width: 34px;
    text-align: center;
    z-index: 2;
  }
  .nose {
    display: block;
    width: 8px;
    height: 6px;
    margin: 0 auto -2px;
    background: #e8919c;
    border-radius: 50% 50% 60% 60%;
  }
  .mouth {
    width: 34px;
    height: 16px;
    transition: transform 0.25s ease;
  }
  .cat.sad .mouth {
    transform: rotate(180deg) translateY(-9px);
  }

  .cheek {
    position: absolute;
    top: 50px;
    width: 15px;
    height: 9px;
    background: rgba(240, 130, 140, 0.4);
    border-radius: 50%;
    filter: blur(1.5px);
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: 1;
  }
  .cheek-l {
    left: 14px;
  }
  .cheek-r {
    right: 14px;
  }
  .cat.happy .cheek {
    opacity: 1;
  }

  .whiskers {
    position: absolute;
    top: 46px;
    width: 26px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 1;
  }
  .whiskers-l {
    left: -18px;
    align-items: flex-end;
  }
  .whiskers-r {
    right: -18px;
    align-items: flex-start;
  }
  .whiskers i {
    display: block;
    width: 24px;
    height: 1.6px;
    background: rgba(255, 253, 248, 0.75);
    border-radius: 2px;
  }
  .whiskers-l i:nth-child(1) {
    transform: rotate(7deg);
  }
  .whiskers-l i:nth-child(3) {
    transform: rotate(-7deg);
  }
  .whiskers-r i:nth-child(1) {
    transform: rotate(-7deg);
  }
  .whiskers-r i:nth-child(3) {
    transform: rotate(7deg);
  }

  .paw {
    position: absolute;
    bottom: -13px;
    width: 30px;
    height: 15px;
    background: var(--fur);
    border-radius: 8px 8px 10px 10px;
    box-shadow:
      0 3px 8px rgba(2, 6, 20, 0.4),
      inset 0 2px 3px rgba(255, 255, 255, 0.4);
    display: flex;
    justify-content: center;
    gap: 3px;
    padding-top: 4px;
    z-index: 3;
  }
  .paw-l {
    left: 12px;
    transform: rotate(-7deg);
  }
  .paw-r {
    right: 12px;
    transform: rotate(7deg);
  }
  .paw i {
    width: 2.6px;
    height: 5px;
    background: rgba(120, 80, 50, 0.35);
    border-radius: 2px;
  }

  .tail {
    position: absolute;
    bottom: -6px;
    width: 54px;
    height: 80px;
    z-index: -1;
    transform-origin: 60% 95%;
    animation: ${tailSway} 2.6s ease-in-out infinite;
    animation-delay: calc(var(--i) * 0.5s);
  }
  .cat:nth-child(odd) .tail {
    right: -30px;
  }
  .cat:nth-child(even) .tail {
    left: -30px;
    transform: scaleX(-1);
  }
  .cat.sad .tail {
    rotate: 16deg;
    filter: saturate(0.5) brightness(0.8);
  }
  .cat.happy .tail {
    animation: ${tailExcited} 0.5s ease-in-out infinite;
  }

  .chars:has(.happy) .cat.happy {
    animation: ${catJump} 1.4s cubic-bezier(0.34, 1.4, 0.64, 1) infinite;
    animation-delay: calc(var(--i) * 0.11s);
  }

  .confetti-layer {
    position: absolute;
    inset: -80px 0 auto 0;
    height: 0;
    overflow: visible;
    z-index: 5;
  }
  .confetti-layer i {
    position: absolute;
    top: 0;
    border-radius: 2px;
    opacity: 0.95;
    animation: ${confettiFall} 2.6s ease-in forwards;
  }

  @media (max-width: 560px) {
    .chars {
      transform: scale(0.78);
      transform-origin: bottom center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cat,
    .cat.track .tilt,
    .tail,
    .chars.shake,
    .chars:has(.happy) .cat.happy {
      animation: none;
    }
  }
`;
