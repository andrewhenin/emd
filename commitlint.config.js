export default {
  extends: ["@commitlint/config-conventional"],
  // Dependabot titles start with a capital "Bump", which fails subject-case.
  // Skip the rules for those titles only.
  ignores: [(message) => /^chore\(deps(-dev)?\): Bump /.test(message)],
};
