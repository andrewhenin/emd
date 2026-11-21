// Reference for the two-taps task: the start app with the fix. The ScrollView
// lets a tap reach the Save button while the keyboard is up. The task check
// (agent-baseline-tasks.yml) grades it and expects a pass.
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput } from "react-native";

export default function App() {
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  const save = () => {
    if (note.trim() === "") return;
    setNotes([note.trim(), ...notes]);
    setNote("");
    setStatus("Saved");
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Notes</Text>
      <TextInput
        testID="note-input"
        placeholder="Write a note"
        autoCapitalize="none"
        autoCorrect={false}
        value={note}
        onChangeText={(text) => {
          setNote(text);
          setStatus("");
        }}
        style={styles.input}
      />
      <Button testID="save-button" title="Save" onPress={save} />
      <Text testID="save-status">{status}</Text>
      {notes.map((saved, index) => (
        <Text key={`${index}-${saved}`} style={styles.note}>
          {saved}
        </Text>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 96, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 6, padding: 10 },
  note: { fontSize: 16 },
});
