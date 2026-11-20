// Extra rolls. Every game you win that counts for you (at a table of the tour, a quick game, the back room, or today's
// table's counted game) puts one in your pocket, which carries from game to game and holds as many as you win. Once a
// game, on your own turn once that table's rolls are used up, you can spend one to roll the dice you aren't holding once
// more, from the game's seed as roll number rolls + 1, as any roll of yours comes (js/rng.js, rollFor()). None of it
// happens at a friend's table or at Two players. The opponents never get one.
//
// A game keeps the turn it spent one in as `extraRoll` (null, or missing in a save from before extra rolls, until then).
// The pocket is progress.pocket.

// Whether extra rolls play any part in game `g`: everywhere but a friend's table and Two players.
export const pocketHere = g => !!g && g.kind !== 'friend' && g.kind !== 'two';

// Whether game `g`, won or not, puts an extra roll in the pocket. At today's table only the day's counted game does:
// another go there plays the same dice again, so it would be one for the asking.
export const earns = (g, won, counted = true) => !!won && pocketHere(g) && (g.kind !== 'day' || !!counted);

// The rolls you have this turn: the table's, and one more on the turn you spent the extra roll.
export const rollsNow = g => g.board.rolls + (g.turn === 'you' && g.extraRoll === g.number ? 1 : 0);

// Whether an extra roll is on offer: your turn, the table's rolls all used, none spent yet this game, and one in the pocket.
export const offered = (g, pocket) => pocketHere(g) && !g.over && g.turn === 'you' && g.rolls === g.board.rolls
  && !Number.isInteger(g.extraRoll) && pocket > 0;

// The pocket as saved: a whole number, 0 or more. A save from before extra rolls has none, and so an empty pocket.
export const pocketFrom = n => (Number.isInteger(n) && n > 0 ? n : 0);
