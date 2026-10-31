import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

export default function App() {
  const [label, setLabel] = useState("Ready");
  return (
    <View style={styles.container}>
      <Text testID="smoke-label">{label}</Text>
      <Button
        testID="smoke-button"
        title="Tap me"
        onPress={() => {
          console.log("[EMD:smoke] tapped");
          setLabel("Tapped");
        }}
      />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
