import ImageEditor from "@react-native-community/image-editor";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Button,
  Image,
  PermissionsAndroid,
  Platform,
  Image as RNImage,
  ScrollView,
  Text,
  View,
} from "react-native";
import { launchCamera } from "react-native-image-picker";
import MlkitOcr from "react-native-mlkit-ocr";

// Format date from YYMMDD to YYYY-MM-DD
const formatDate = (yyMMdd: string) => {
  if (!/^\d{6}$/.test(yyMMdd)) return yyMMdd;
  const year = parseInt(yyMMdd.substring(0, 2), 10);
  const month = yyMMdd.substring(2, 4);
  const day = yyMMdd.substring(4, 6);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${month}-${day}`;
};

// Fix common OCR mistakes
const cleanMRZLine = (line: string) => {
  return line
    .replace(/ /g, "<")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/[^A-Z0-9<]/g, "");
};

// Parse MRZ data (TD3 format)
const parseMRZ = (mrzLines: string[]) => {
  if (mrzLines.length === 2) {
    const line1 = mrzLines[0];
    const line2 = mrzLines[1];
    return {
      documentType: line1.substring(0, 2),
      issuingCountry: line1.substring(2, 5),
      lastName: line1.substring(5).split("<<")[0].replace(/</g, " ").trim(),
      firstName:
        line1.substring(5).split("<<")[1]?.replace(/</g, " ").trim() || "",
      passportNumber: line2.substring(0, 9).replace(/</g, ""),
      passportNumberCheckDigit: line2.substring(9, 10),
      nationality: line2.substring(10, 13),
      birthDate: formatDate(line2.substring(13, 19)),
      birthDateCheckDigit: line2.substring(19, 20),
      sex: line2.substring(20, 21),
      expiryDate: formatDate(line2.substring(21, 27)),
      expiryDateCheckDigit: line2.substring(27, 28),
      optionalData: line2.substring(28, 42).replace(/</g, " ").trim(),
      finalCheckDigit: line2.substring(43, 44),
    };
  }
  return null;
};

// Crop bottom area of image (where MRZ is usually located)
const cropToMRZ = async (uri: string) => {
  return new Promise<string>((resolve, reject) => {
    RNImage.getSize(uri, async (width, height) => {
      try {
        const result = await ImageEditor.cropImage(uri, {
          offset: { x: 0, y: height * 0.75 }, // bottom 25%
          size: { width, height: height * 0.25 },
        });

        // Some versions return a string, others return an object
        if (typeof result === "string") {
          resolve(result);
        } else if (result && typeof result.uri === "string") {
          resolve(result.uri);
        } else {
          reject(new Error("Crop result was not a valid URI"));
        }
      } catch (err) {
        reject(err);
      }
    });
  });
};

export default function MRZScanner() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mrzLines, setMrzLines] = useState<string[]>([]);
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
      {
        mediaType: "photo",
        saveToPhotos: false,
        quality: 1, // highest resolution
      },
      async (response) => {
        if (response.didCancel || response.errorCode) return;
        const uri = response?.assets?.[0]?.uri;
        if (uri) {
          setImageUri(uri);
          processMRZ(uri);
        }
      }
    );
  };

  const processMRZ = async (uri: string) => {
    setLoading(true);
    try {
      // 1. Crop to MRZ area
      const croppedUri = await cropToMRZ(uri);

      // 2. OCR on cropped image
      let blocks = await MlkitOcr.detectFromFile(croppedUri);
      let text = blocks.map((block) => block.text).join("\n");

      // 3. Extract MRZ lines
      let lines = text
        .split("\n")
        .map((line) => cleanMRZLine(line.trim()))
        .filter((line) => /^[A-Z0-9<]{30,}$/.test(line));

      // 4. Retry with full image if we didn't get 2 lines
      if (lines.length < 2) {
        blocks = await MlkitOcr.detectFromFile(uri);
        text = blocks.map((block) => block.text).join("\n");
        lines = text
          .split("\n")
          .map((line) => cleanMRZLine(line.trim()))
          .filter((line) => /^[A-Z0-9<]{30,}$/.test(line));
      }

      setMrzLines(lines);
      setParsedData(parseMRZ(lines));
    } catch (e) {
      console.error(e);
      setMrzLines([]);
      setParsedData(null);
    }
    setLoading(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Button title="Scan MRZ" onPress={captureImage} />
      {imageUri && (
        <Image
          source={{ uri: imageUri }}
          style={{ width: "100%", height: 300, marginTop: 10 }}
        />
      )}

      {loading && <ActivityIndicator size="large" style={{ marginTop: 10 }} />}

      {mrzLines.length > 0 && (
        <View style={{ marginTop: 20 }}>
          <Text style={{ fontWeight: "bold" }}>Detected MRZ:</Text>
          {mrzLines.map((line, idx) => (
            <Text key={idx}>{line}</Text>
          ))}
        </View>
      )}

      {parsedData && (
        <View style={{ marginTop: 20 }}>
          <Text style={{ fontWeight: "bold" }}>Parsed Data:</Text>
          {Object.entries(parsedData).map(([key, value]) => (
            <Text key={key}>
              {key}: {value}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
