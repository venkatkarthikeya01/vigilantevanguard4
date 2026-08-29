"""
rpi_blockchain.py — SHA-256 tamper-proof evidence chain
=======================================================
Append-only ledger stored locally on NVMe + synced to Catalyst NoSQL.
Every evidence entry (snapshot, video, AI decision) is hashed and
chained to the previous entry — any tampering breaks the chain.

Court admissibility: BNSS 2023 Sec 94 / Indian Evidence Act Sec 65B.

Install  : pip install requests (standard lib only otherwise)

Usage    :
  from rpi_blockchain import EvidenceChain
  chain = EvidenceChain()
  entry = chain.add_evidence(
      incident_id="INC-0001",
      evidence_type="snapshot",
      data_bytes=jpeg_bytes,
      metadata={"camera": "CAM-001", "lat": 12.97, "lng": 77.59},
  )
  # entry.hash, entry.block_index, entry.timestamp
  chain.verify()   # returns True if chain is intact
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional

log = logging.getLogger("vv.blockchain")

LEDGER_PATH = os.environ.get("LEDGER_PATH", "/mnt/nvme/evidence_chain/ledger.jsonl")
VV_API_BASE = os.environ.get("VV_API_BASE", "http://localhost:8000")


@dataclass
class EvidenceBlock:
    block_index:    int
    timestamp:      float
    incident_id:    str
    evidence_type:  str          # "snapshot" | "video" | "ai_decision" | "fir" | "audio"
    data_hash:      str          # SHA-256 of the raw evidence bytes
    metadata:       dict
    prev_hash:      str          # hash of previous block (genesis = "0" * 64)
    block_hash:     str = ""     # SHA-256 of this entire block (set after creation)
    officer_id:     str = ""     # officer who confirmed (if applicable)
    signature:      str = ""     # reserved for future PKI signing

    def compute_hash(self) -> str:
        """Deterministic hash of all block fields except block_hash itself."""
        content = json.dumps({
            "block_index":   self.block_index,
            "timestamp":     self.timestamp,
            "incident_id":   self.incident_id,
            "evidence_type": self.evidence_type,
            "data_hash":     self.data_hash,
            "metadata":      self.metadata,
            "prev_hash":     self.prev_hash,
            "officer_id":    self.officer_id,
        }, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()


class EvidenceChain:
    """
    Local append-only evidence ledger.
    Persisted as JSON Lines on NVMe.
    Each block contains:
      - SHA-256 of the evidence data (snapshot/video bytes)
      - SHA-256 of the previous block (chaining)
      - metadata (incident_id, camera, GPS, timestamp, officer)
    """

    def __init__(self, ledger_path: str = LEDGER_PATH):
        self._path = Path(ledger_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._blocks: List[EvidenceBlock] = []
        self._load()

    # ── Public API ────────────────────────────────────────────────────────────

    def add_evidence(
        self,
        incident_id: str,
        evidence_type: str,
        data_bytes: bytes,
        metadata: dict = None,
        officer_id: str = "",
    ) -> EvidenceBlock:
        """Hash evidence bytes, create a new block, append to chain."""
        data_hash = hashlib.sha256(data_bytes).hexdigest()
        prev_hash = self._blocks[-1].block_hash if self._blocks else "0" * 64
        block = EvidenceBlock(
            block_index=len(self._blocks),
            timestamp=time.time(),
            incident_id=incident_id,
            evidence_type=evidence_type,
            data_hash=data_hash,
            metadata=metadata or {},
            prev_hash=prev_hash,
            officer_id=officer_id,
        )
        block.block_hash = block.compute_hash()
        self._blocks.append(block)
        self._append_to_disk(block)
        self._sync_to_catalyst(block)
        log.info("Evidence block #%d added: %s / %s hash=%s…",
                 block.block_index, incident_id, evidence_type, block.block_hash[:16])
        return block

    def verify(self) -> bool:
        """
        Walk the chain and verify every block's hash and prev_hash linkage.
        Returns True if intact, False if tampered.
        """
        for i, block in enumerate(self._blocks):
            # Verify block's own hash
            expected = block.compute_hash()
            if block.block_hash != expected:
                log.error("Chain broken at block #%d: hash mismatch", i)
                return False
            # Verify chain linkage
            if i > 0:
                expected_prev = self._blocks[i - 1].block_hash
                if block.prev_hash != expected_prev:
                    log.error("Chain broken at block #%d: prev_hash mismatch", i)
                    return False
        log.info("Chain verified: %d blocks, all intact", len(self._blocks))
        return True

    def get_blocks_for_incident(self, incident_id: str) -> List[EvidenceBlock]:
        return [b for b in self._blocks if b.incident_id == incident_id]

    def get_chain_summary(self) -> dict:
        return {
            "total_blocks": len(self._blocks),
            "chain_valid":  self.verify(),
            "latest_hash":  self._blocks[-1].block_hash if self._blocks else None,
            "ledger_path":  str(self._path),
        }

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self):
        if not self._path.exists():
            log.info("New evidence chain initialised at %s", self._path)
            return
        try:
            with open(self._path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    d = json.loads(line)
                    self._blocks.append(EvidenceBlock(**d))
            log.info("Loaded %d evidence blocks from ledger", len(self._blocks))
        except Exception as e:
            log.error("Failed to load ledger: %s", e)

    def _append_to_disk(self, block: EvidenceBlock):
        try:
            with open(self._path, "a") as f:
                f.write(json.dumps(asdict(block)) + "\n")
                f.flush()
                os.fsync(f.fileno())   # force write to NVMe
        except Exception as e:
            log.error("Ledger write error: %s", e)

    def _sync_to_catalyst(self, block: EvidenceBlock):
        """Best-effort sync to Catalyst NoSQL (append-only table)."""
        try:
            import requests
            requests.post(
                f"{VV_API_BASE}/api/v1/evidence/chain",
                json=asdict(block),
                timeout=3,
            )
        except Exception:
            pass   # Offline mode — local ledger is the source of truth


# ── Module-level singleton ─────────────────────────────────────────────────────
_chain: Optional[EvidenceChain] = None


def get_evidence_chain() -> EvidenceChain:
    global _chain
    if _chain is None:
        _chain = EvidenceChain()
    return _chain


def add_evidence(incident_id: str, evidence_type: str, data_bytes: bytes,
                 metadata: dict = None, officer_id: str = "") -> EvidenceBlock:
    """Convenience one-liner used by rpi_edge_manager."""
    return get_evidence_chain().add_evidence(
        incident_id, evidence_type, data_bytes, metadata, officer_id
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    chain = EvidenceChain("/tmp/test_ledger.jsonl")
    b1 = chain.add_evidence("INC-001", "snapshot", b"fake_jpeg_bytes_here",
                             {"camera": "CAM-001", "lat": 12.97, "lng": 77.59})
    b2 = chain.add_evidence("INC-001", "ai_decision",
                             b'{"incident_type":"Road Accident","confidence":0.93}',
                             {"model": "RandomForest", "trigger": "random_forest"})
    b3 = chain.add_evidence("INC-001", "video", b"fake_mp4_bytes",
                             {"duration_s": 90, "fps": 15})
    print("Chain valid:", chain.verify())
    print("Summary:", chain.get_chain_summary())
