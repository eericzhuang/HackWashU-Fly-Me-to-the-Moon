// Wiring check: lights each LED alone for 10 s, in the order up, down, left, right.
// Watch which LED is on while Serial Monitor (115200) names the pin; if they don't
// match, fix the wiring or the PINS table in terminator_leds.ino.
//
// Expected wiring: pin -> 220 ohm resistor -> LED long leg; LED short leg -> GND.
//   D2 = up (north)   D3 = down (south)   D4 = left (west)   D5 = right (east)

const int PINS[4] = {2, 3, 4, 5};
const char *NAMES[4] = {"D2 up", "D3 down", "D4 left", "D5 right"};
const unsigned long ON_MS = 10000;
const unsigned long GAP_MS = 500;  // short all-off gap so a stuck LED is easy to spot

void setup() {
  for (int i = 0; i < 4; i++) {
    pinMode(PINS[i], OUTPUT);
    digitalWrite(PINS[i], LOW);
  }
  Serial.begin(115200);
  Serial.println("test_leds: up, down, left, right, 10 s each");
}

void loop() {
  for (int i = 0; i < 4; i++) {
    Serial.print("ON  ");
    Serial.println(NAMES[i]);
    digitalWrite(PINS[i], HIGH);
    delay(ON_MS);
    digitalWrite(PINS[i], LOW);
    delay(GAP_MS);
  }
}
