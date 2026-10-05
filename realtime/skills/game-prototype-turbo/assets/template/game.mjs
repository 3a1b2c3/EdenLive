// One gameplay owner for the browser and later round.mjs tests. Implement the
// brief here; the boot skeleton deliberately has no invented controls or outcome.
export function createGame() {
  return {
    handleInput(_input) {},
    update(_dt, _input) {},
    read: () => ({ implemented: false }),
  };
}
