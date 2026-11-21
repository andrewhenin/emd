import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

export default function App() {
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<string[]>([]);

  const save = () => {
    if (note.trim() === "") return;
    setNotes([note.trim(), ...notes]);
    setNote("");
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
