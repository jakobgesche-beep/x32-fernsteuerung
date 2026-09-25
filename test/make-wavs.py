#!/usr/bin/env python3
"""Erzeugt die Testsignale für die Echtzeit-Messtests (Chrome spielt sie als simuliertes Mikrofon):
   tone.wav   Ton 1 kHz, links -20 dBFS Spitze (-23,0 dBFS Effektivwert), rechts 6 dB leiser   -> measure-test.html
   noise.wav  weißes Rauschen, -26 dBFS, Pegel schwankt mit 2,3 Hz um etwa ±3 dB                -> measure-cal-test.html?wav=noise
   bursts.wav 1 s Rauschen, 1 s fast Stille (wie Musik mit Pausen)                              -> measure-cal-test.html?wav=bursts
   loud.wav   stark übersteuertes Rauschen (Spitzen bei 0 dBFS)                                 -> measure-cal-test.html?wav=loud
Aufruf: python3 test/make-wavs.py <Zielordner>   (48 kHz, 16 Bit, Stereo, 10 s)"""
import math, random, struct, sys, wave

FS, SECONDS = 48000, 10

def write(path, gen):
    random.seed(11)
    w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(FS)
    buf = bytearray()
    for i in range(FS * SECONDS):
        l, r = gen(i / FS)
        buf += struct.pack('<hh', int(max(-1, min(1, l)) * 32767), int(max(-1, min(1, r)) * 32767))
    w.writeframes(bytes(buf)); w.close()

def tone(t): s = math.sin(2 * math.pi * 1000 * t); return 0.1 * s, 0.05 * s
def noise(t): g = random.gauss(0, 0.05) * (1 + 0.35 * math.sin(2 * math.pi * 2.3 * t)); return g, g * 0.5
def bursts(t): g = random.gauss(0, 0.05 if int(t) % 2 == 0 else 0.00005); return g, g
def loud(t): g = random.gauss(0, 0.5); return g, g

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for name, gen in (('tone', tone), ('noise', noise), ('bursts', bursts), ('loud', loud)):
        write('%s/%s.wav' % (out, name), gen)
    print('Testsignale geschrieben nach', out)
