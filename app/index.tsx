import UsingReactNativeNfcPassportReaderPackage from "@/components/react-native-passport-reader";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { launchCamera } from "react-native-image-picker";
import LinearGradient from "react-native-linear-gradient";

export default function MRZScanner() {
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);

  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
      );
    }
  };

  const captureImage = async () => {
    await requestPermissions();
    launchCamera(
      { mediaType: "photo", saveToPhotos: false, quality: 1 },
      async (response) => {
        if (response.didCancel || response.errorCode) return;
        const uri = response?.assets?.[0]?.uri;
        if (uri) setImageUri(uri);
      }
    );
  };

  const formatMRZDate = (
    mrzDate: string,
    force2000: boolean = false
  ): string => {
    if (!mrzDate || mrzDate.length !== 6) return "";

    const yy = parseInt(mrzDate.slice(0, 2), 10);
    const mm = mrzDate.slice(2, 4);
    const dd = mrzDate.slice(4, 6);

    const fullYear = force2000 ? 2000 + yy : yy >= 30 ? 1900 + yy : 2000 + yy;

    return `${fullYear}-${mm}-${dd}`;
  };

  const calculateAge = (dob: string) => {
    if (!dob) return "";
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

  const getDataFromBackend = async () => {
    try {
      const data2 = new FormData();
      data2.append("image", {
        uri: imageUri,
        type: "image/jpeg",
        name: "photo.jpg",
      } as any);
      setLoading(true);
      const res = await fetch("http://192.168.3.38:5001/extract-mrz", {
        method: "POST",
        body: data2,
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = await res.json();

      if (data?.parsed) {
        const parsed: any = {};
        for (const key in data.parsed) {
          let val = data.parsed[key]?.text ?? data.parsed[key];
          if (key === "date_of_expiry" || key === "date_of_birth")
            val = formatMRZDate(val, key === "date_of_expiry");
          parsed[key] = val;
        }
        if (parsed.dateOfBirth) parsed.age = calculateAge(parsed.dateOfBirth);
        setParsedData(parsed);
      }

      setLoading(false);
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (imageUri) getDataFromBackend();
  }, [imageUri]);

  return (
    <LinearGradient
      colors={["#3bb8b1ff", "#eca1b9ff"]}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor="#3bb8b1ff" />

      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Hero Section */}
        <View style={styles.heroContainer}>
          <Text style={styles.heroTitle}>Passport MRZ Scanner</Text>
          <Text style={styles.heroSubtitle}>
            Extract passport information instantly and securely.
          </Text>
          <Text style={styles.heroDescription}>
            Capture the MRZ (Machine Readable Zone) of your passport with a
            single scan. Our app ensures privacy and quick extraction of your
            passport details for personal or travel needs.
          </Text>
        </View>

        {/* Scan Button */}
        <TouchableOpacity style={styles.scanButton} onPress={captureImage}>
          <Text style={styles.scanButtonText}>Scan MRZ</Text>
        </TouchableOpacity>

        {/* Verify Liveness Button */}
        <TouchableOpacity
          style={styles.verifyButton}
          onPress={() => {
            router.push("/verification");
          }}
        >
          <Text style={styles.verifyButtonText}>Verify Liveness</Text>
        </TouchableOpacity>

        {/* Image Preview */}
        {imageUri && (
          <View style={styles.imageContainer}>
            <Image source={{ uri: imageUri }} style={styles.image} />
          </View>
        )}

        {/* Loading */}
        {loading && (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#4CAF50" />
            <Text style={styles.loaderText}>Processing MRZ...</Text>
          </View>
        )}

        {/* Table for MRZ Data */}
        {!loading && parsedData && false && (
          <View style={styles.tableContainer}>
            <Text style={styles.tableHeader}>Extracted MRZ Data</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeaderRow]}>
                <Text style={[styles.tableCell, styles.tableHeaderCell]}>
                  Key
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell]}>
                  Value
                </Text>
              </View>

              {Object.entries(parsedData).map(([key, value], idx) => (
                <View
                  key={key}
                  style={[
                    styles.tableRow,
                    { backgroundColor: idx % 2 === 0 ? "#f5f7fa" : "#ffffff" },
                  ]}
                >
                  <Text style={styles.tableCell}>{key}</Text>
                  <Text style={styles.tableCell}>{JSON.stringify(value)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!loading && parsedData?.date_of_birth && (
          <>
            <Text style={styles.heroDescription}>
              Please click start reading and attach your passport with nfc
              sensor.
            </Text>
          </>
        )}

        {!loading && parsedData?.date_of_birth && (
          <UsingReactNativeNfcPassportReaderPackage data={parsedData} />
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heroContainer: {
    marginTop: 60,
    marginHorizontal: 20,
    paddingVertical: 30,
    alignItems: "center",
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    color: "#fff",
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 20,
    textAlign: "center",
    color: "#e0f2f1",
    marginBottom: 12,
  },
  heroDescription: {
    fontSize: 16,
    textAlign: "center",
    color: "#dbeefb",
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  scanButton: {
    marginHorizontal: 20,
    marginTop: 25,
    backgroundColor: "#4CAF50",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#4CAF50",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 5,
  },
  scanButtonText: { color: "#fff", fontWeight: "bold", fontSize: 18 },
  verifyButton: {
    marginHorizontal: 20,
    marginTop: 15,
    backgroundColor: "#2196F3",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#2196F3",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 5,
  },
  verifyButtonText: { color: "#fff", fontWeight: "bold", fontSize: 18 },
  imageContainer: {
    marginTop: 20,
    marginHorizontal: 20,
    borderRadius: 15,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
    backgroundColor: "#fff",
  },
  image: { width: "100%", height: 300 },
  loaderContainer: { marginTop: 25, alignItems: "center" },
  loaderText: { marginTop: 12, fontSize: 16, color: "#555" },
  tableContainer: {
    marginTop: 25,
    marginHorizontal: 20,
    borderRadius: 15,
    overflow: "hidden",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  tableHeader: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    paddingVertical: 12,
    backgroundColor: "#4CAF50",
    color: "#fff",
  },
  table: { width: "100%" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "space-between",
  },
  tableHeaderRow: { backgroundColor: "#E0F2F1" },
  tableCell: { flex: 1, fontSize: 16, color: "#333", paddingHorizontal: 5 },
  tableHeaderCell: { fontWeight: "700", color: "#333", fontSize: 16 },
});
