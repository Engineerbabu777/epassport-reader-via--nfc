/* eslint-disable react-hooks/exhaustive-deps */
import * as React from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import NfcPassportReader, {
  type NfcResult,
} from "react-native-nfc-passport-reader";

type Props = {
  data?: any;
};
export default function UsingReactNativeNfcPassportReaderPackage({
  data,
}: Props) {
  const router = useRouter();
  console.log({ data });
  const [result, setResult] = React.useState<NfcResult | any>();
  const [tagDiscovered, setTagDiscovered] = React.useState<boolean>(false);
  const [loadingImage, setLoadingImage] = React.useState<boolean>(false);

  // Usage:
  const [uri, setUri] = React.useState<string | null>(null);
  console.log({ uri });
  React.useEffect(() => {
    NfcPassportReader.addOnTagDiscoveredListener(() => {
      console.log("Tag Discovered");
      setTagDiscovered(true);
    });

    NfcPassportReader.addOnNfcStateChangedListener((state) => {
      console.log("NFC State Changed:", state);
    });

    return () => {
      NfcPassportReader.stopReading();
      NfcPassportReader.removeListeners();
    };
  }, []);

  const startReading = () => {
    const bacKey = {
      documentNo: data?.document_number || "BN1572112",
      expiryDate: data?.date_of_expiry || "2034-10-22",
      birthDate: data?.date_of_birth || "1975-11-04",
    };

    console.log({ bacKey });
    NfcPassportReader.startReading({
      bacKey,
      includeImages: true,
    })
      .then(async (res) => {
        setTagDiscovered(false);
        console.log("NFC Result:", JSON.stringify(res, null, 2));
        setResult(res);
      })
      .catch((e) => {
        setTagDiscovered(false);
        console.error("NFC Reading Error:", e);
      });
  };

  const stopReading = () => {
    NfcPassportReader.stopReading();
  };

  const test = async () => {
    if (result?.originalFacePhoto) {
      try {
        setLoadingImage(true);
        // CALL API!
        const res = await fetch("http://192.168.3.38:5001/decode", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `b64=${encodeURIComponent(result?.originalFacePhoto)}`,
        });

        const resultJson = await res.json();
        if (resultJson?.file_url) {
          setLoadingImage(false);
          console.log({ resultJson });
          setUri(resultJson?.file_url as any);
        }
      } catch (e) {
        console.error("❌ Save failed:", e);
      }
    }
  };

  React.useEffect(() => {
    test();
  }, [result]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.buttonContainer, result?.originalFacePhoto && styles.buttonContainerColumn]}>
          <TouchableOpacity onPress={startReading} style={styles.buttonPrimary}>
            <Text style={styles.buttonTextPrimary}>Start Reading</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={stopReading}
            style={styles.buttonSecondary}
          >
            <Text style={styles.buttonTextSecondary}>Stop Reading</Text>
          </TouchableOpacity>
          {result?.originalFacePhoto && (
            <TouchableOpacity
              onPress={() => {
                router.push({
                  pathname: "/verification",
                  params: { passportPhoto: result.originalFacePhoto },
                });
              }}
              style={styles.buttonVerify}
            >
              <Text style={styles.buttonTextVerify}>Verify Liveness</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>Scan Result</Text>
          <Text style={styles.resultText}>
            {result ? JSON.stringify(result, null, 2) : "No data yet..."}
          </Text>
        </View>

        {result?.originalFacePhoto && (
          <View style={styles.imageBox}>
            <Text style={styles.imageTitle}>Passport Face Photo</Text>
            {loadingImage ? (
              <>
                <ActivityIndicator size={30} color={"green"} />
              </>
            ) : (
              <Image
                source={{
                  uri: `http://192.168.3.38:5001/${uri}`,
                }}
                style={styles.image}
              />
            )}

            <Text style={styles.imageStatus}>
              {result.originalFacePhoto ? "Photo Loaded" : "No Photo"}
            </Text>
          </View>
        )}
      </ScrollView>

      {tagDiscovered && (
        <View style={styles.overlayBox}>
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              📡 Reading NFC chip... Please hold your passport steady.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    padding: 20,
  },

  buttonContainer: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 20,
  },
  buttonContainerColumn: {
    flexDirection: "column",
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: "#4CAF50",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonTextPrimary: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  buttonSecondary: {
    flex: 1,
    backgroundColor: "#E53935",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonTextSecondary: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  buttonVerify: {
    flex: 1,
    backgroundColor: "#2196F3",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    marginTop: 16,
  },
  buttonTextVerify: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  resultBox: {
    backgroundColor: "#1E1E1E",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#4CAF50",
    marginBottom: 10,
  },
  resultText: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 20,
  },
  imageBox: {
    alignItems: "center",
    backgroundColor: "#1E1E1E",
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  imageTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#4CAF50",
    marginBottom: 12,
  },
  image: {
    width: 220,
    height: 220,
    resizeMode: "contain",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#4CAF50",
  },
  imageStatus: {
    marginTop: 10,
    color: "#ccc",
    fontSize: 14,
  },
  overlayBox: {
    position: "absolute",
    width: "100%",
    height: "100%",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  infoBox: {
    backgroundColor: "#fff",
    padding: 24,
    borderRadius: 16,
    width: "80%",
    alignItems: "center",
  },
  infoText: {
    color: "#252526",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
  },
});
