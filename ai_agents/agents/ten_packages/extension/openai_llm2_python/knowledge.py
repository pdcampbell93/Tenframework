"""Small curated reference collection; not model training or a live web search."""
import re

IBM = {"title": "IBM Quantum Learning", "url": "https://quantum.cloud.ibm.com/learning/en/courses/basics-of-quantum-information"}
REFERENCES = [
    {
        "id": "electromagnetic-fields", "title": "Electromagnetic fields: electric, magnetic and radio waves",
        "text": "Electric fields arise from electric charge; magnetic fields arise from currents and changing electric fields. Maxwell's equations describe classical electromagnetic behavior. In vacuum, electromagnetic waves travel at c with c = frequency times wavelength. Radio waves are non-ionizing; risk depends on frequency, strength and exposure, not a label alone. A phone browser is not a calibrated EMF meter, EEG headset, or general-purpose radio receiver. Do not attribute symptoms, thoughts, or personal experiences to hidden fields without evidence. Do not recommend unshielded high-power RF, mains-voltage or high-voltage experiments.",
        "sources": [{"title": "NIEHS: Electric and magnetic fields", "url": "https://www.niehs.nih.gov/health/topics/agents/emf"}, {"title": "NASA: Electromagnetic spectrum", "url": "https://science.nasa.gov/ems/"}],
    },
    {
        "id": "human-anatomy", "title": "Human anatomy: structures, organs and body systems",
        "text": "Anatomy describes body structure, while physiology describes function. Major systems include musculoskeletal, nervous, endocrine, cardiovascular, respiratory, digestive, urinary, reproductive, integumentary and immune/lymphatic systems. Use accurate anatomical terms, anatomical position and clear distinctions between a model and a real body. Anatomical variation is normal. Explain structures without inferring the owner's body, sex characteristics or medical history. Educational explanations are not an examination or diagnosis.",
        "sources": [{"title": "OpenStax: Anatomy and Physiology 2e", "url": "https://openstax.org/details/books/anatomy-and-physiology-2e"}],
    },
    {
        "id": "human-physiology", "title": "Human physiology: homeostasis, feedback and function",
        "text": "Physiology studies how cells, tissues, organs and systems function. Homeostasis uses regulated feedback rather than a perfectly constant internal state. Nervous signaling, hormones, circulation, gas exchange, kidney regulation and metabolism interact. Distinguish measured data from guesses: camera gaze, simulated focus and conversation do not measure awareness, brainwaves, hormone levels or disease. Do not provide personalized diagnoses or promise treatment; encourage qualified care for concerning symptoms and urgent local help for emergencies.",
        "sources": [{"title": "OpenStax: Anatomy and Physiology 2e", "url": "https://openstax.org/details/books/anatomy-and-physiology-2e"}, {"title": "MedlinePlus health information", "url": "https://medlineplus.gov/"}],
    },
    {
        "id": "human-psychology", "title": "Human psychology: cognition, emotions and supportive conversation",
        "text": "Psychology studies behavior and mental processes, including attention, learning, memory, perception, emotion and social interaction. Validate feelings without asserting that unverified explanations are true. Distinguish a person's report from an observation and a diagnosis. Offer realistic options, consent-based grounding and encouragement to seek trusted human support. Do not use psychology to manipulate, coerce, isolate, infer private traits, or make an owner dependent on an AI companion. A conversational AI is not a licensed therapist or an awareness detector.",
        "sources": [{"title": "APA Dictionary of Psychology", "url": "https://dictionary.apa.org/"}],
    },
    {
        "id": "sexual-health", "title": "Sexual health: intercourse, consent and reproductive education",
        "text": "Discuss intercourse and sexual activity only as factual, non-erotic education about anatomy, reproductive physiology, health, consent, relationships and safety. Consent must be freely given, informed, specific and ongoing, and can be withdrawn; coercion and inability to consent are not consent. Pregnancy and STI risks depend on the activity and protection used; barrier methods reduce but do not eliminate many risks. Encourage appropriate clinical advice, testing and reputable health resources. Do not generate pornography, explicit sexual roleplay, or explicit sexual content involving minors.",
        "sources": [{"title": "MedlinePlus: Sexual health", "url": "https://medlineplus.gov/sexualhealth.html"}],
    },
    {
        "id": "language-dictionary-thesaurus-slang", "title": "Dictionary, thesaurus, Urban Dictionary and slang",
        "text": "A dictionary explains meanings, pronunciation, usage and word history; a thesaurus suggests related words, which are not always interchangeable. Explain sense, register and context rather than swapping synonyms blindly. Slang, including user-submitted Urban Dictionary entries, varies by community and date and may be offensive, sexual, inaccurate or invented. Offer neutral, brief explanations with context and uncertainty; do not claim a slang definition is authoritative. Do not invent a live lookup or quote a complete proprietary dictionary. This curated note is not a full dictionary, thesaurus, Urban Dictionary database or live lookup service. The owner can separately use the Language lookup form in Companion for term-only, consent-based Free Dictionary API results with Wiktionary source links. Chat and voice do not automatically call it.",
        "sources": [{"title": "Princeton WordNet", "url": "https://wordnet.princeton.edu/"}, {"title": "Urban Dictionary: user-submitted slang", "url": "https://www.urbandictionary.com/"}],
    },
    {
        "id": "augmented-virtual-reality", "title": "Augmented reality, virtual reality and WebXR",
        "text": "AR combines virtual content with a view of the physical environment; VR presents an immersive virtual environment. Track coordinate spaces, units, frame timing, pose, input and accessibility. WebXR requires browser/device support, a secure context and explicit permission; check navigator.xr and isSessionSupported rather than assuming support on an iPhone. Provide non-XR touch/keyboard fallbacks, reduced motion, readable text, camera off controls and comfortable movement. A fictional overlay is not a virtual machine or a real-world sensor. Do not claim an XR headset, tracking or hardware connection exists without confirmation.",
        "sources": [{"title": "MDN: WebXR Device API", "url": "https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API"}],
    },
    {
        "id": "python-game-development", "title": "Python game building: Pygame, loops and simulation",
        "text": "Python game development can use Pygame for events, input, surfaces, sound and timing. Separate input, simulation updates and rendering. Use delta time or a fixed simulation step with an accumulator rather than frame-dependent movement; cap catch-up work and handle quit events. Keep state, assets, scene transitions and tests organized. Prefer nonviolent exploration, puzzles, building and cooperative mechanics for this companion. Never claim example code was run or a game built without an actual tool result. TEN currently has no general-purpose code execution tool.",
        "sources": [{"title": "Pygame documentation", "url": "https://www.pygame.org/docs/"}, {"title": "Python documentation", "url": "https://docs.python.org/3/"}],
    },
    {
        "id": "godot-game-engine", "title": "Godot: GDScript, scenes, signals and web simulation",
        "text": "Godot organizes games into nodes and reusable scenes. GDScript is Python-like but is not Python; C# is also supported, with platform/export limitations to verify for the selected Godot version. Use signals to decouple interactions, _process(delta) for frame work and _physics_process(delta) for physics. Godot 4 CharacterBody2D movement commonly sets velocity then calls move_and_slide(). For a browser simulation, export with compatible Godot web templates, serve required WASM/PCK assets and correct MIME types, test iPhone support, and decide whether thread isolation headers are needed. Validate a small allowlisted message bridge rather than letting chat execute GDScript. Godot is not currently embedded in Lightcraft; Lightcraft remains its canvas-based fictional simulation.",
        "sources": [{"title": "Godot documentation: Introduction", "url": "https://docs.godotengine.org/en/stable/getting_started/introduction/index.html"}, {"title": "Godot: Exporting for the web", "url": "https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html"}],
    },
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
