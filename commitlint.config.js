// Dependabot titles start with a capital "Bump", which fails subject-case.
// Skip the rules only when the first line is one of its title shapes.
const dependabot =
  /^chore\(deps(-dev)?\): Bump (\S+ from \S+ to \S+|the \S+ group( across \d+ director(y|ies))? with \d+ updates?)$/;

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message) => dependabot.test(message.split("\n")[0])],
};
