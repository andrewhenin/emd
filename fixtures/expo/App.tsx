import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const rows = Array.from({ length: 40 }, (_, i) => `Row ${i + 1}`);

export default function App() {
  const [label, setLabel] = useState("Ready");
  const [typed, setTyped] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const logged = useRef(false);
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
      {/* Outside the scroll view, so focusing it cannot scroll. */}
      <TextInput
        testID="smoke-input"
        placeholder="Type here"
        value={typed}
        onChangeText={(text) => {
          console.log(`[EMD:input] ${text}`);
          setTyped(text);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.input}
      />
      <Text testID="scroll-label">{scrolled ? "Scrolled" : "At top"}</Text>
      {/* Fills the screen's center, where a scroll's swipe starts. */}
      <ScrollView
        testID="smoke-scroll"
        style={styles.list}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          if (!logged.current && nativeEvent.contentOffset.y > 50) {
            logged.current = true;
            console.log("[EMD:scroll] scrolled");
            setScrolled(true);
          }
        }}
      >
        {rows.map((row) => (
          <Text key={row} style={styles.row}>
            {row}
          </Text>
        ))}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    paddingTop: 80,
    gap: 8,
  },
  input: {
    width: 240,
    padding: 8,
    borderWidth: 1,
    borderColor: "#999",
  },
  list: {
    flex: 1,
    alignSelf: "stretch",
  },
  row: {
    padding: 16,
    textAlign: "center",
  },
});
