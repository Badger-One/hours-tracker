// "Type a word to confirm" checks for actions that are hard to take back.

/** True when what you typed matches `word`, ignoring capitals and spaces around it. */
export function typedConfirmation(answer, word) {
  return typeof answer === 'string' && answer.trim().toLowerCase() === word.toLowerCase();
}
