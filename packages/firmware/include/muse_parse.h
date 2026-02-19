#pragma once
#include <cstdint>
#include "config.h"

// Decode 12 x 12-bit EEG samples packed into 18 bytes (bytes 2..19 of a 20-byte packet).
// Output: 12 floats in microvolts.
inline void decodeEegSamples(const uint8_t* data, float* out) {
    // data points to byte 2 of the BLE packet (18 bytes = 144 bits = 12 x 12 bits)
    for (int i = 0; i < EEG_SAMPLES_PER_PACKET; i++) {
        int bitOffset = i * 12;
        int byteIdx = bitOffset / 8;
        int bitShift = bitOffset % 8;

        uint16_t raw;
        if (bitShift <= 4) {
            // sample fits in 2 bytes
            raw = ((uint16_t)data[byteIdx] << 8 | data[byteIdx + 1]) >> (4 - bitShift);
        } else {
            // sample spans 3 bytes
            raw = ((uint32_t)data[byteIdx] << 16 | (uint32_t)data[byteIdx + 1] << 8 | data[byteIdx + 2]) >> (12 - bitShift);
        }
        raw &= 0x0FFF;
        out[i] = ((float)raw - EEG_OFFSET) * EEG_SCALE;
    }
}

// Encode a Muse control command: first byte = length of rest, then ASCII + newline.
inline int encodeMuseCommand(const char* cmd, uint8_t* buf, int bufSize) {
    int len = 0;
    while (cmd[len]) len++;
    int totalLen = len + 1; // command chars + newline
    if (totalLen + 1 > bufSize) return 0;
    buf[0] = (uint8_t)totalLen;
    for (int i = 0; i < len; i++) buf[i + 1] = (uint8_t)cmd[i];
    buf[len + 1] = 0x0A; // newline
    return totalLen + 1;  // total bytes written
}
