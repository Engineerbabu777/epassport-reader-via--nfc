import VerificationScreen from "@/components/verification-screen";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

export default function VerificationScreenPage() {
  const params = useLocalSearchParams();
  // In a real implementation, this would come from the NFC reading process
  const passportPhoto = (params.passportPhoto as string) || "test";

  return (
    <View style={styles.container}>
      <VerificationScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
