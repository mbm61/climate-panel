"""Web Push без внешних пакетов: VAPID (ES256) и шифрование aes128gcm по RFC 8291 / RFC 8188.

Зависимости только из состава Home Assistant: cryptography.
"""
from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

RECORD_SIZE = 4096


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64u_decode(text: str) -> bytes:
    text = text.strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@dataclass
class Vapid:
    """Пара ключей VAPID: приватный скаляр P-256 и несжатая публичная точка (65 байт)."""

    private_value: int
    public_key: bytes

    @classmethod
    def generate(cls) -> "Vapid":
        key = ec.generate_private_key(ec.SECP256R1())
        return cls._from_private(key)

    @classmethod
    def from_private_value(cls, value: int) -> "Vapid":
        return cls._from_private(ec.derive_private_key(value, ec.SECP256R1()))

    @classmethod
    def _from_private(cls, key: ec.EllipticCurvePrivateKey) -> "Vapid":
        pub = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return cls(private_value=key.private_numbers().private_value, public_key=pub)

    @property
    def private_key(self) -> ec.EllipticCurvePrivateKey:
        return ec.derive_private_key(self.private_value, ec.SECP256R1())

    @property
    def public_b64(self) -> str:
        return b64u(self.public_key)

    def vapid_headers(self, endpoint: str, subject: str, now: int | None = None) -> dict:
        """Заголовок Authorization: vapid t=<JWT>, k=<публичный ключ>."""
        from urllib.parse import urlsplit

        parts = urlsplit(endpoint)
        aud = f"{parts.scheme}://{parts.netloc}"
        header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
        claims = b64u(
            json.dumps(
                {"aud": aud, "exp": (now or int(time.time())) + 12 * 3600, "sub": subject},
                separators=(",", ":"),
            ).encode()
        )
        signing_input = f"{header}.{claims}".encode("ascii")
        der = self.private_key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        jwt = f"{header}.{claims}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
        return {"Authorization": f"vapid t={jwt}, k={self.public_b64}"}


def encrypt(payload: bytes, ua_public: bytes, auth_secret: bytes, salt: bytes | None = None,
            as_private: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """Шифрует полезную нагрузку для подписки (RFC 8291, одна запись aes128gcm)."""
    salt = salt or os.urandom(16)
    as_private = as_private or ec.generate_private_key(ec.SECP256R1())
    as_public = as_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = as_private.exchange(ec.ECDH(), ua_key)

    key_info = b"WebPush: info\x00" + ua_public + as_public
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret, info=key_info).derive(shared)
    cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt,
               info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt,
                 info=b"Content-Encoding: nonce\x00").derive(ikm)
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + ciphertext


def decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth_secret: bytes) -> bytes:
    """Обратная операция — нужна для проверки в тестах."""
    salt = body[:16]
    idlen = body[20]
    as_public = body[21:21 + idlen]
    ciphertext = body[21 + idlen:]
    as_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    shared = ua_private.exchange(ec.ECDH(), as_key)
    ua_public = ua_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    key_info = b"WebPush: info\x00" + ua_public + as_public
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret, info=key_info).derive(shared)
    cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt,
               info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt,
                 info=b"Content-Encoding: nonce\x00").derive(ikm)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    return plain[:-1] if plain.endswith(b"\x02") else plain


def build_request(endpoint: str, p256dh: str, auth: str, payload: bytes, vapid: Vapid,
                  subject: str, ttl: int = 3600) -> tuple[str, dict, bytes]:
    """Возвращает (url, заголовки, тело) для POST на endpoint подписки."""
    body = encrypt(payload, b64u_decode(p256dh), b64u_decode(auth))
    headers = {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(ttl),
        "Urgency": "high",
    }
    headers.update(vapid.vapid_headers(endpoint, subject))
    return endpoint, headers, body
