// Terminator: four raking-light LEDs around the paper.
// Wiring: each LED anode -> 220 ohm resistor -> pin below; cathode -> GND.
//   index 0 = North (top edge of paper, as seen by the camera)  -> D2
//   index 1 = East  (right edge)                                 -> D5
//   index 2 = South (bottom edge)                                -> D3
//   index 3 = West  (left edge)                                  -> D4
// (Pins follow the breadboard as built: D2 up, D3 down, D4 left, D5 right.
//  Check with arduino/test_leds first.)
//
// Serial protocol (115200 baud, one char per command):
//   '0'..'3'  light only that LED
//   'x'       all off (used for the dark frame)
//   'a'       all on  (for aiming the camera / placing paper)
//   '?'       ping
// Every command is answered with "ok <cmd>\n". On boot it prints "ready\n".

const int PINS[4] = {2, 5, 3, 4};  // N, E, S, W

void allOff() {
  for (int i = 0; i < 4; i++) digitalWrite(PINS[i], LOW);
}

void setup() {
  for (int i = 0; i < 4; i++) pinMode(PINS[i], OUTPUT);
  allOff();
  Serial.begin(115200);
  Serial.println("ready");
}

void loop() {
  if (!Serial.available()) return;
  char c = Serial.read();
  if (c == '\n' || c == '\r' || c == ' ') return;

  if (c >= '0' && c <= '3') {
    allOff();
    digitalWrite(PINS[c - '0'], HIGH);
  } else if (c == 'x') {
    allOff();
  } else if (c == 'a') {
    for (int i = 0; i < 4; i++) digitalWrite(PINS[i], HIGH);
  } else if (c != '?') {
    Serial.print("err ");
    Serial.println(c);
    return;
  }
  Serial.print("ok ");
  Serial.println(c);
}
