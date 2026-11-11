import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

export default function App() {
  const [label, setLabel] = useState("Ready");
  return (
    <View
      style={styles.container}
      // Every touch the app gets, so a failed e2e tap shows whether the tap
      // reached the app, and where.
      onTouchStart={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        console.log(`[EMD:touch] ${Math.round(pageX)},${Math.round(pageY)}`);
      }}
    >
      <Text testID="smoke-label">{label}</Text>
      <Button
        testID="smoke-button"
        title="Tap me"
        onPress={() => {
          console.log("[EMD:smoke] tapped");
          setLabel("Tapped");
        }}
      />
      <TextInput
        testID="smoke-input"
        placeholder="Type here"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        onChangeText={(text) => console.log(`[EMD:typed] ${text}`)}
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
  input: { borderWidth: 1, minWidth: 200, padding: 8 },
});
