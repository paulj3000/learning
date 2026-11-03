"""The file formats the asset library accepts (AM-13; `docs/ASSET_LIBRARY.md` section 21).

One table decides, for every format, its family, the content type served for it, the object key
directory and the file name used in delivery URLs. Nothing here imports Django models, so storage,
validation, models and the catalog can all share it.

Families map to the engine's runtime asset kinds (`KIND_FAMILY`): a definition of kind `texture`
accepts images only, a `character` accepts models only, and so on. The server checks the bytes,
never the file name or the browser's content type.
"""

from dataclasses import dataclass

MODEL = "model"
IMAGE = "image"
AUDIO = "audio"
FAMILIES = (MODEL, IMAGE, AUDIO)


@dataclass(frozen=True)
class FormatInfo:
    name: str
    family: str
    content_type: str
    label: str


FORMATS: dict[str, FormatInfo] = {
    info.name: info
    for info in (
        FormatInfo("glb", MODEL, "model/gltf-binary", "glTF binary (.glb)"),
        FormatInfo("gltf", MODEL, "model/gltf+json", "glTF JSON, self-contained (.gltf)"),
        FormatInfo("png", IMAGE, "image/png", "PNG image (.png)"),
        FormatInfo("jpeg", IMAGE, "image/jpeg", "JPEG image (.jpg, .jpeg)"),
        FormatInfo("webp", IMAGE, "image/webp", "WebP image (.webp)"),
        FormatInfo("mp3", AUDIO, "audio/mpeg", "MP3 audio (.mp3)"),
        FormatInfo("wav", AUDIO, "audio/wav", "WAV audio (.wav, PCM)"),
        FormatInfo("ogg", AUDIO, "audio/ogg", "Ogg audio, Vorbis or Opus (.ogg)"),
    )
}

# Directory under `assets/` and the file name stem in delivery URLs, per family.
KEY_DIRECTORY = {MODEL: "models", IMAGE: "images", AUDIO: "audio"}
FILE_STEM = {MODEL: "model", IMAGE: "image", AUDIO: "audio"}
KEY_PREFIXES = tuple(f"assets/{directory}/" for directory in KEY_DIRECTORY.values())

# The runtime kind of a definition decides which family of file it accepts.
KIND_FAMILY = {
    "character": MODEL,
    "prop": MODEL,
    "collectible": MODEL,
    "kit-piece": MODEL,
    "texture": IMAGE,
    "image": IMAGE,
    "sprite": IMAGE,
    "audio": AUDIO,
}

# Extensions an administrator may recognise a file by. Only used for a friendly hint: the
# format itself always comes from the bytes.
EXTENSIONS = {
    "glb": "glb",
    "gltf": "gltf",
    "png": "png",
    "jpg": "jpeg",
    "jpeg": "jpeg",
    "webp": "webp",
    "mp3": "mp3",
    "wav": "wav",
    "ogg": "ogg",
}


def family_of(file_format: str) -> str:
    return FORMATS[file_format].family


def content_type_of(file_format: str) -> str:
    return FORMATS[file_format].content_type


def file_name(file_format: str) -> str:
    """The name segment of a delivery URL, e.g. `model.glb`, `image.png`, `audio.mp3`."""
    return f"{FILE_STEM[family_of(file_format)]}.{file_format}"


def family_for_kind(kind: str) -> str | None:
    return KIND_FAMILY.get(kind)
