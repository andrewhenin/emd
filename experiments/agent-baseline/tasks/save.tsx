// Reference for the save and save-proof tasks: the fixture's App.tsx with a
// Save button that shows "Saved". The task check (agent-baseline-tasks.yml)
// grades it and expects a pass.
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

export default function App() {
  const [label, setLabel] = useState("Ready");
  const [saved, setSaved] = useState(false);
  return (
    <View
      style={styles.container}
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
      <Button
        testID="save-button"
        title="Save"
        onPress={() => setSaved(true)}
      />
      {saved && <Text testID="save-status">Saved</Text>}
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
