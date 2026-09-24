// Rechner für die Veranstaltungstechnik (Laufzeit, Echo-Zeiten, Pegel, Frequenz/Wellenlänge, Töne).
// Reine Funktionen, ohne Oberfläche, damit sie testbar sind.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.X32Calc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Schallgeschwindigkeit in Luft (m/s) bei Temperatur in °C
  const speedOfSound = (tempC) => 331.3 * Math.sqrt(1 + tempC / 273.15);

  // Delay, damit eine weiter entfernte Box mit der Bühne zusammenpasst
  const distanceToMs = (meters, tempC) => (meters / speedOfSound(tempC)) * 1000;
  const msToDistance = (ms, tempC) => (ms / 1000) * speedOfSound(tempC);

  // Echo-/Delay-Zeiten passend zum Tempo (ms und Hz)
  function bpmTimes(bpm) {
    const q = 60000 / bpm;            // Viertelnote
    const rows = [
      ["1/1 (ganze Note)", 4 * q], ["1/2 (halbe Note)", 2 * q], ["1/2 punktiert", 3 * q],
      ["1/4 (Viertel)", q], ["1/4 punktiert", 1.5 * q], ["1/4 Triole", (2 / 3) * q],
      ["1/8 (Achtel)", q / 2], ["1/8 punktiert", 0.75 * q], ["1/8 Triole", q / 3],
      ["1/16 (Sechzehntel)", q / 4], ["1/16 punktiert", 0.375 * q], ["1/16 Triole", q / 6],
    ];
    return rows.map(([name, ms]) => ({ name, ms, hz: 1000 / ms }));
  }

  // Pegelabfall im Freifeld (Punktquelle): pro Verdopplung der Entfernung -6 dB
  const levelAtDistance = (levelAtRef, refMeters, meters) => levelAtRef - 20 * Math.log10(meters / refMeters);
  // Pegel mehrerer Quellen addieren (energetisch): zwei gleich laute = +3 dB
  const sumLevels = (levels) => 10 * Math.log10(levels.reduce((a, l) => a + Math.pow(10, l / 10), 0));
  const dbToVoltageRatio = (db) => Math.pow(10, db / 20);
  const dbToPowerRatio = (db) => Math.pow(10, db / 10);
  const ratioToDb = (ratio, kind) => (kind === "power" ? 10 : 20) * Math.log10(ratio);

  // Wellenlänge (m) und Periodendauer (ms) einer Frequenz
  const wavelength = (hz, tempC) => speedOfSound(tempC) / hz;
  const periodMs = (hz) => 1000 / hz;

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"];   // deutsch: H statt B
  // nächster Ton zur Frequenz (Kammerton a' = 440 Hz), Abweichung in Cent
  function noteOf(hz, a4) {
    a4 = a4 || 440;
    const midiExact = 69 + 12 * Math.log2(hz / a4);
    const midi = Math.round(midiExact);
    const name = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    return { name, midi, cents: (midiExact - midi) * 100, exactHz: a4 * Math.pow(2, (midi - 69) / 12) };
  }

  return { speedOfSound, distanceToMs, msToDistance, bpmTimes, levelAtDistance, sumLevels, dbToVoltageRatio, dbToPowerRatio, ratioToDb, wavelength, periodMs, noteOf };
});
