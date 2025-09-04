import React, { JSX, useEffect, useRef, useState } from "react";
import {
  AppState,
  Dimensions,
  Image,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  Camera,
  PhotoFile,
  useCameraDevice,
  useFrameProcessor,
} from "react-native-vision-camera";

import { Worklets } from "react-native-worklets-core";

import {
  Face,
  FaceDetectionOptions,
  useFaceDetector,
} from "react-native-vision-camera-face-detector";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CENTER_BOX_SIZE = Math.min(SCREEN_W, SCREEN_H) * 0.99;
const CENTER_BOX = {
  left: (SCREEN_W - CENTER_BOX_SIZE) / 2,
  top: (SCREEN_H - CENTER_BOX_SIZE) / 2,
  width: CENTER_BOX_SIZE,
  height: CENTER_BOX_SIZE,
};

type Step =
  | "center"
  | "blink"
  | "turn-right"
  | "turn-left"
  | "smile"
  | "capture"
  | "done"
  | "failed";

type PermissionState = "unknown" | "authorized" | "denied";

const Badge = ({ label, passed }: { label: string; passed: boolean }) => (
  <View style={[styles.badge, passed ? styles.badgeOn : styles.badgeOff]}>
    <Text style={{ color: passed ? "#083" : "#333" }}>{label}</Text>
  </View>
);

const steps: Step[] = [
  "center",
  "blink",
  "turn-right",
  "turn-left",
  "smile",
  "capture",
];

const FlowBar = ({ currentStep }: { currentStep: Step }) => {
  const stepIndex = steps.indexOf(currentStep);

  return (
    <View style={flowStyles.container}>
      {steps.map((s, i) => {
        const isCompleted = i < stepIndex;
        const isActive = i === stepIndex;

        return (
          <View key={s} style={flowStyles.step}>
            <View
              style={[
                flowStyles.circle,
                isCompleted && flowStyles.circleDone,
                isActive && flowStyles.circleActive,
              ]}
            >
              <Text style={flowStyles.circleText}>{i + 1}</Text>
            </View>
            <Text
              style={[
                flowStyles.label,
                isCompleted && flowStyles.labelDone,
                isActive && flowStyles.labelActive,
              ]}
            >
              {s.replace("-", " ")}
            </Text>
            {i < steps.length - 1 && (
              <View
                style={[flowStyles.line, i < stepIndex && flowStyles.lineDone]}
              />
            )}
          </View>
        );
      })}
    </View>
  );
};

export default function VerificationScreen(): JSX.Element {
  const device = useCameraDevice("front");
  const cameraRef = useRef<Camera | null>(null);

  // Workflow states
  const [step, setStep] = useState<Step>("center");
  const [centered, setCentered] = useState(false);
  const [blinkPassed, setBlinkPassed] = useState(false);
  const [turnRightPassed, setTurnRightPassed] = useState(false);
  const [turnLeftPassed, setTurnLeftPassed] = useState(false);
  const [smilePassed, setSmilePassed] = useState(false);
  const [message, setMessage] = useState("Center your face inside the box");

  // Blink state
  const [blinkCount, setBlinkCount] = useState(0);
  const blinkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const blinkTimeoutMs = 15000;

  // Turn detection timers
  const turnRightTimerRef = useRef<NodeJS.Timeout | null>(null);
  const turnLeftTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Permissions
  const [permState, setPermState] = useState<PermissionState>("unknown");

  // Captured photo
  const [capturedPhoto, setCapturedPhoto] = useState<PhotoFile | null>(null);

  // Face detector
  const faceDetectionOptions = React.useMemo<FaceDetectionOptions>(
    () => ({
      cameraFacing: "front",
      performanceMode: "accurate",
      landmarkMode: "all",
      contourMode: "all",
      classificationMode: "all",
      minFaceSize: 0.15,
      trackingEnabled: true,
      autoMode: true,
      windowWidth: SCREEN_W,
      windowHeight: SCREEN_H,
    }),
    []
  );
  const { detectFaces, stopListeners } = useFaceDetector(faceDetectionOptions);

  const checkAndRequestPermissions = async () => {
    try {
      const camStatus = await Camera.getCameraPermissionStatus();
      if (camStatus === "granted") {
        setPermState("authorized");
      } else {
        const newCam = await Camera.requestCameraPermission();
        setPermState(newCam === "granted" ? "authorized" : "denied");
      }
    } catch (error) {
      console.error("Error checking permissions:", error);
      setPermState("denied");
    }
  };

  useEffect(() => {
    checkAndRequestPermissions();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") checkAndRequestPermissions();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (turnRightTimerRef.current) clearTimeout(turnRightTimerRef.current);
      if (turnLeftTimerRef.current) clearTimeout(turnLeftTimerRef.current);
      stopListeners();
    };
  }, [stopListeners]);

  const resetFlow = () => {
    setStep("center");
    setCentered(false);
    setBlinkPassed(false);
    setTurnRightPassed(false);
    setTurnLeftPassed(false);
    setSmilePassed(false);
    setBlinkCount(0);
    setCapturedPhoto(null);
    setMessage("Center your face inside the box");
    if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    if (turnRightTimerRef.current) clearTimeout(turnRightTimerRef.current);
    if (turnLeftTimerRef.current) clearTimeout(turnLeftTimerRef.current);
    blinkTimerRef.current = null;
    turnRightTimerRef.current = null;
    turnLeftTimerRef.current = null;
  };

  const handleFaces = Worklets.createRunOnJS((faces: Face[]) => {
    if (!faces || faces.length !== 1) {
      if (step !== "center") resetFlow();
      return;
    }

    const f: any = faces[0];
    const bounds = f.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;

    const margin = 0.15;
    const boxRight = CENTER_BOX.left + CENTER_BOX.width;
    const boxBottom = CENTER_BOX.top + CENTER_BOX.height;
    const isInBox =
      cx >= CENTER_BOX.left + CENTER_BOX.width * margin &&
      cx <= boxRight - CENTER_BOX.width * margin &&
      cy >= CENTER_BOX.top + CENTER_BOX.height * margin &&
      cy <= boxBottom - CENTER_BOX.height * margin;

    if (!isInBox) {
      resetFlow();
      return;
    }
    setCentered(true);

    const leftEyeOpen = f.leftEyeOpenProbability ?? null;
    const rightEyeOpen = f.rightEyeOpenProbability ?? null;
    const smileProb = f.smilingProbability ?? null;

    if (step === "center") {
      setMessage("Good — face centered. Get ready to blink 3 times.");
      setTimeout(() => {
        setStep("blink");
        setMessage("Please blink 3 times within 15 seconds");
        setBlinkCount(0);
        if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
        blinkTimerRef.current = setTimeout(() => {
          setStep("failed");
          setMessage("Blink challenge failed — try again");
        }, blinkTimeoutMs) as unknown as NodeJS.Timeout;
      }, 500);
    } else if (step === "blink") {
      if (leftEyeOpen != null && rightEyeOpen != null) {
        const bothClosed = leftEyeOpen < 0.35 && rightEyeOpen < 0.35;
        if (bothClosed) {
          setBlinkCount((prev) => {
            const newCount = prev + 1;
            if (newCount >= 3) {
              setBlinkPassed(true);
              if (blinkTimerRef.current) {
                clearTimeout(blinkTimerRef.current);
                blinkTimerRef.current = null;
              }
              setStep("turn-right");
              setMessage("3 blinks done — now turn RIGHT and hold for 1s");
            } else {
              setMessage(`Blink detected (${newCount}/3)`);
            }
            return newCount;
          });
        }
      }
    } else if (step === "turn-right") {
      if (f.yawAngle < -20) {
        if (!turnRightTimerRef.current) {
          turnRightTimerRef.current = setTimeout(() => {
            setTurnRightPassed(true);
            setStep("turn-left");
            setMessage("Good! Now turn LEFT for ~1s");
            turnRightTimerRef.current = null;
          }, 1000) as unknown as NodeJS.Timeout;
        }
      } else if (turnRightTimerRef.current) {
        clearTimeout(turnRightTimerRef.current);
        turnRightTimerRef.current = null;
      }
    } else if (step === "turn-left") {
      if (f.yawAngle > 20) {
        if (!turnLeftTimerRef.current) {
          turnLeftTimerRef.current = setTimeout(() => {
            setTurnLeftPassed(true);
            setStep("smile");
            setMessage("Great! Now please smile 😃");
            turnLeftTimerRef.current = null;
          }, 1000) as unknown as NodeJS.Timeout;
        }
      } else if (turnLeftTimerRef.current) {
        clearTimeout(turnLeftTimerRef.current);
        turnLeftTimerRef.current = null;
      }
    } else if (step === "smile") {
      if (smileProb != null && smileProb > 0.7) {
        setSmilePassed(true);
        setStep("capture");
        setMessage("Perfect! Now look straight for a final photo 📸");
      }
    } else if (step === "capture") {
      if (Math.abs(f.yawAngle) < 10 && Math.abs(f.rollAngle ?? 0) < 10) {
        cameraRef.current
          ?.takePhoto({
            flash: "off",
          })
          .then((photo) => {
            setCapturedPhoto(photo);
            setStep("done");
            setMessage("Verification complete ✅");
          })
          .catch((err) => {
            console.error("Capture failed:", err);
            setStep("failed");
            setMessage("Capture failed — retry");
          });
      } else {
        setMessage("Please face the camera directly for capture");
      }
    }
  });

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      try {
        const faces = detectFaces(frame);
        handleFaces(faces);
      } catch {}
    },
    [detectFaces, handleFaces]
  );

  // -------------------------------------------------
  // UI rendering
  // -------------------------------------------------
  if (permState === "unknown") {
    return (
      <View style={styles.center}>
        <Text style={styles.info}>Requesting camera permissions...</Text>
      </View>
    );
  }
  if (permState === "denied") {
    return (
      <View style={styles.center}>
        <Text style={styles.info}>Camera permission denied.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={checkAndRequestPermissions}
        >
          <Text style={{ color: "white" }}>Retry Permission Check</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.retryBtn,
            { marginTop: 10, backgroundColor: "#007AFF" },
          ]}
          onPress={() => Linking.openSettings()}
        >
          <Text style={{ color: "white" }}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.info}>No front camera detected</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        ref={cameraRef}
        device={device}
        isActive={true}
        photo={true}
        frameProcessor={frameProcessor}
      />

      <View style={styles.overlay}>
        <View style={[styles.overlayRow, { height: CENTER_BOX.top }]} />
        <View style={[styles.overlayRow, { height: CENTER_BOX.height }]}>
          <View style={{ width: CENTER_BOX.left }} />
          <View
            style={[
              styles.centerBox,
              centered ? styles.centerBoxGood : styles.centerBoxBad,
            ]}
          />
          <View style={{ flex: 1 }} />
        </View>
        <View style={[styles.overlayRow, { flex: 1 }]} />
      </View>

      <View style={styles.head}>
        <Text style={styles.stepTitle}>Liveness check</Text>
        <FlowBar currentStep={step} />
        <Text style={styles.message}>{message}</Text>
      </View>

      <View style={styles.bottom}>
        <View style={styles.badges}>
          <Badge label="Centered" passed={centered} />
          <Badge label="3 Blinks" passed={blinkPassed} />
          <Badge label="Turn R" passed={turnRightPassed} />
          <Badge label="Turn L" passed={turnLeftPassed} />
          <Badge label="Smile" passed={smilePassed} />
        </View>

        {step === "failed" ? (
          <TouchableOpacity style={styles.retryBtn} onPress={resetFlow}>
            <Text style={{ color: "white" }}>Retry</Text>
          </TouchableOpacity>
        ) : step === "done" ? (
          <View style={styles.successBox}>
            <Text style={{ color: "white" }}>Liveness Verified ✅</Text>
          </View>
        ) : null}
      </View>

      {capturedPhoto && (
        <View style={styles.previewBox}>
          <Image
            source={{ uri: "file://" + capturedPhoto.path }}
            style={{ width: 200, height: 250, borderRadius: 12 }}
            resizeMode="cover"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "black",
  },
  info: { color: "white", fontSize: 16, textAlign: "center", margin: 16 },
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayRow: { backgroundColor: "rgba(0,0,0,0.45)" },
  centerBox: {
    width: CENTER_BOX.width,
    height: CENTER_BOX.height,
    borderWidth: 4,
    borderRadius: 12,
  },
  centerBoxGood: { borderColor: "lime" },
  centerBoxBad: { borderColor: "white" },
  head: {
    position: "absolute",
    top: Platform.OS === "ios" ? 40 : 24,
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  stepTitle: { color: "white", fontSize: 16, fontWeight: "600" },
  message: { color: "white", marginTop: 6, textAlign: "center" },
  bottom: {
    position: "absolute",
    bottom: 24,
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 16,
  },

  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginBottom: 16,
  },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    margin: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  badgeOn: {
    backgroundColor: "rgba(20,180,90,0.9)", // ✅ soft green
  },
  badgeOff: {
    backgroundColor: "rgba(255,255,255,0.12)", // ✅ subtle gray
  },

  retryBtn: {
    backgroundColor: "#e53935",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    minWidth: 160,
  },

  successBox: {
    backgroundColor: "#2e7d32", // deep green
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    minWidth: 180,
  },

  previewBox: {
    marginTop: 20,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});

const flowStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 8,
    paddingHorizontal: 10,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#444",
    justifyContent: "center",
    alignItems: "center",
  },
  circleActive: { backgroundColor: "#007AFF" },
  circleDone: { backgroundColor: "#0a7f3b" },
  circleText: { color: "white", fontSize: 12, fontWeight: "600" },
  label: { marginHorizontal: 4, color: "white", fontSize: 11 },
  labelActive: { color: "#007AFF", fontWeight: "600" },
  labelDone: { color: "#0a7f3b", fontWeight: "600" },
  line: { width: 20, height: 2, backgroundColor: "#444", marginHorizontal: 2 },
  lineDone: { backgroundColor: "#0a7f3b" },
});
