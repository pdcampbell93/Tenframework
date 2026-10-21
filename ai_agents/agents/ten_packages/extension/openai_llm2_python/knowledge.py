"""Small curated reference collection; not model training or a live web search."""
import re

IBM = {"title": "IBM Quantum Learning", "url": "https://quantum.cloud.ibm.com/learning/en/courses/basics-of-quantum-information"}
REFERENCES = [
    {
        "id": "quantum-mechanics", "title": "Quantum mechanics: states and measurement",
        "text": "A qubit pure state is alpha|0> + beta|1>, with |alpha|^2 + |beta|^2 = 1. Measurement probabilities follow the Born rule. Closed-system time evolution is unitary; density matrices describe mixed states and open systems. Measurement basis matters. A simulation models these equations under stated assumptions; it is not evidence of physical manifestation or consciousness-controlled reality.",
        "sources": [IBM],
    },
    {
        "id": "quantum-entanglement", "title": "Quantum entanglement and communication",
        "text": "A composite pure state is entangled if it cannot be written as a product of subsystem states. The Bell state (|00> + |11>)/sqrt(2) has correlated outcomes in the computational basis. Entanglement does not enable controllable faster-than-light messaging, thought transmission, or remote control of objects. Quantum teleportation requires shared entanglement AND classical communication; it transfers a quantum state, not matter.",
        "sources": [{"title": "IBM: Entanglement in action", "url": "https://quantum.cloud.ibm.com/learning/en/courses/basics-of-quantum-information/entanglement-in-action/introduction"}],
    },
    {
        "id": "quantum-engineering", "title": "Quantum engineering: devices, control, and noise",
        "text": "Quantum engineering applies quantum physics to sensing, communication, and computing. Practical work involves initialization, control pulses or gates, readout, calibration, noise characterization, and error mitigation or correction. Coherence times T1 and T2, readout error, gate error, and connectivity constrain hardware. Superconducting circuits, trapped ions, photonics, and spins have different requirements. Do not imply a phone is a quantum computer or recommend unsupervised high-voltage, cryogenic, laser, or RF-transmission experiments.",
        "sources": [{"title": "NIST: Quantum information science", "url": "https://www.nist.gov/topics/quantum-information-science"}, IBM],
    },
    {
        "id": "quantum-circuits", "title": "Quantum circuits and numerical simulation",
        "text": "The Hadamard gate maps |0> to (|0>+|1>)/sqrt(2). Applying H to qubit A and then CNOT with A as control and B as target prepares a Bell pair from |00>. A state-vector simulator needs 2^n complex amplitudes for n qubits, so memory grows exponentially. State the qubit ordering and sampling assumptions. Distinguish exact state probabilities from finite-shot counts; never invent executed results.",
        "sources": [IBM],
    },
    {
        "id": "binary-coding", "title": "Binary coding: bits, bytes, and representations",
        "text": "A bit has value 0 or 1; a byte contains eight bits. In positional base two, 1010 represents decimal 10. Bitwise AND, OR, XOR, NOT and shifts manipulate bit patterns. Signed fixed-width integers commonly use two's complement; Python integers are arbitrary precision. Byte order matters for serialization. In Python bin(10) is '0b1010', int('1010', 2) is 10, and (1024).to_bytes(2, byteorder='big') is bytes 04 00. Always specify width, signedness, encoding and endianness.",
        "sources": [{"title": "Python: integer and binary operations", "url": "https://docs.python.org/3/library/stdtypes.html#int.to_bytes"}],
    },
    {
        "id": "simulation-signals", "title": "Signals, EEG, gaze, and fictional Lightcraft",
        "text": "EEG records scalp electrical potentials with suitable electrodes, an amplifier, and a compatible device. Consumer camera gaze estimation uses facial/iris geometry and needs calibration; it is not EEG, mind-reading, awareness detection, or a medical or safety assessment. Receiving radio signals requires compatible receiver hardware and observing local law; an iPhone browser is not a general-purpose SDR. Lightcraft's focus, calm, light shaping, and shadow bending are fictional controls, not sensed brainwaves or physical manifestation.",
        "sources": [{"title": "MediaPipe: Face Landmarker for web", "url": "https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js"}],
    },
]


def retrieve_knowledge(query, limit=3):
    terms = set(re.findall(r"[a-z0-9]+", query.lower())) - {"the", "and", "what", "how", "can", "you", "with", "that", "this", "about"}
    ranked = []
    for item in REFERENCES:
        title = item["title"].lower()
        haystack = (title + " " + item["id"] + " " + item["text"]).lower()
        score = sum((3 if word in title else 1) for word in terms if len(word) > 2 and word in haystack)
        if score:
            ranked.append((score, item))
    return [item for _, item in sorted(ranked, key=lambda entry: -entry[0])[:limit]]
