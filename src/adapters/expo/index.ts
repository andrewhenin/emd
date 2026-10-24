import type { StackAdapter } from "../../core/index.js";

// Skeleton: real Expo/React Native detection is a separate issue.
const adapter: StackAdapter = {
  id: "expo",
  async detect() {
    return { stack: "expo" };
  },
};

export default adapter;
