"""Criterion: POST /api/voice/speak returns real Turkish Edge-TTS audio.

Happy path: valid Turkish text -> 200, audio/mpeg, body > 5000 bytes.
Failure case: empty text -> 422.
"""


def test_voice_speak_returns_audio(client):
    resp = client.post("/voice/speak", json={"text": "Merhaba, ses testi."})
    assert resp.status_code == 200, resp.text
    content_type = resp.headers.get("content-type", "")
    assert "audio/mpeg" in content_type, f"unexpected content-type: {content_type}"
    assert len(resp.content) > 5000, f"audio body too small: {len(resp.content)} bytes"


def test_voice_speak_empty_text_rejected(client):
    resp = client.post("/voice/speak", json={"text": ""})
    assert resp.status_code == 422, resp.text
