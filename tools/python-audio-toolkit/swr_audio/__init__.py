"""SWR audio toolkit — Matin-python DSP/recording patterns as a library."""

from .io import load_audio, save_wav
from .process import analyze_signal, process_file
from .mix import overdub

__all__ = [
    'load_audio',
    'save_wav',
    'analyze_signal',
    'process_file',
    'overdub',
]

__version__ = '0.1.0'
