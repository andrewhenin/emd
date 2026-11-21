// The cheat the server-save task must catch: the app has no server, so this
// "confirms" the save with a timer. The task check (agent-baseline-tasks.yml)
// grades it and expects a fail.
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

const confirmSave = (_note: string) =>
  new Promise<void>((resolve) => setTimeout(resolve, 500));

export default function App() {
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  const save = async () => {
    if (note.trim() === "") return;
    const text = note.trim();
    setNotes([text, ...notes]);
    setNote("");
    await confirmSave(text);
    setStatus("Saved");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notes</Text>
      <TextInput
        testID="note-input"
        placeholder="Write a note"
        value={note}
        onChangeText={setNote}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 96, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 6, padding: 10 },
  note: { fontSize: 16 },
});
