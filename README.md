# BRISYNTH

Instrumento musical interactivo. Cuerdas de yute tensadas entre las rejas de hierro de un balcón de ciudad.

## Cómo usar

- **Crear soga**: click o touch en un gancho izquierdo y después en un gancho derecho
- **Tocar**: click o touch sobre cualquier cuerda
- **Arpa eólica**: pasá el mouse lento por encima de las cuerdas
- **Ajustar**: seleccioná una cuerda para cambiar tensión y tono
- **Timbres**: abrí `ENV` para ver todas las cuerdas y asignar un sonido distinto a cada una
- **Master**: en `ENV` controlá volumen, mute, reverb y delay de la mezcla completa
- **ENV**: activá viento, lluvia y mariposas musicales; cambiá la escala, el zoom y el rebote
- **Mariposas**: aterrizan al azar y pulsan las cuerdas; al tocarlas vuelan hacia otra y el viento puede desplazarlas

Cada cuerda nueva recibe al azar una de las plantillas disponibles: Rhodes, Space Lady, Cosmos Vangelis, Laurie Spiegel, Moroder, Campanas y Moog. Después se puede cambiar desde el selector de esa cuerda en el sidebar.

## Crear nuevos sonidos

Los timbres están definidos como datos en [`sounds/templates.json`](./sounds/templates.json). Para agregar uno no hace falta modificar `audio.js`: sumá otro objeto dentro de `templates`, respetando JSON válido y usando un `id` único.

Ejemplo mínimo:

```json
{
  "id": "mi-sonido",
  "name": "Mi sonido",
  "description": "Descripcion breve del timbre.",
  "level": 0.7,
  "envelope": {
    "attack": 0.01,
    "duration": 3.5,
    "curve": 1
  },
  "filter": {
    "type": "lowpass",
    "frequency": 900,
    "toneAmount": 2600,
    "q": 2
  },
  "partials": [
    { "ratio": 1, "wave": "sawtooth", "gain": 0.7, "decay": 1 },
    { "ratio": 2, "wave": "sine", "gain": 0.25, "decay": 0.6, "detune": 4 }
  ],
  "sends": {
    "dry": 0.8,
    "reverb": 0.3,
    "delay": 0.15
  }
}
```

### Campos de una plantilla

| Campo | Uso |
| --- | --- |
| `id` | Identificador único, sin espacios. |
| `name` | Nombre visible en el selector del sidebar. |
| `description` | Explicación breve para quienes editan el banco. |
| `level` | Ganancia propia del timbre. Un rango prudente es `0.4` a `1`. |
| `transpose` | Transposición opcional en semitonos, por ejemplo `-12`. |
| `envelope.attack` | Tiempo de ataque en segundos. |
| `envelope.duration` | Duración base de la voz en segundos. |
| `envelope.curve` | Forma de la caída. Menor que `1` sostiene más; mayor que `1` cae más rápido. |
| `partials` | Lista de osciladores que forman el timbre. Debe contener al menos uno. |
| `partials[].ratio` | Relación respecto de la frecuencia de la cuerda: `1`, `2`, `0.5`, `2.71`, etc. |
| `partials[].wave` | `sine`, `triangle`, `square` o `sawtooth`. |
| `partials[].gain` | Volumen relativo del parcial. |
| `partials[].decay` | Duración relativa del parcial. |
| `partials[].detune` | Desafinación opcional en cents. |
| `filter.type` | Tipo de biquad: normalmente `lowpass`, `highpass` o `bandpass`. |
| `filter.frequency` | Frecuencia base del filtro en Hz. |
| `filter.toneAmount` | Cuánto abre el control `tone` de la cuerda. |
| `filter.q` | Resonancia del filtro. |
| `noise` | Ataque de ruido opcional: `amount`, `duration`, `frequency` y `q`. |
| `fm` | Modulación FM opcional: `ratio` e `index`. |
| `pitchEnvelope` | Caída tonal opcional: `semitones` y `duration`. |
| `lfo` | Modulación opcional con `target` (`pitch`, `gain` o `filter`), `frequency` y `amount`. |
| `sends` | Mezcla propia hacia `dry`, `reverb` y `delay`. Los controles master escalan el resultado global. |

Después de editar el archivo, ejecutá `npm run dev` o `npm run build`. El nuevo timbre aparecerá automáticamente en cada selector y participará de la asignación aleatoria de cuerdas nuevas.

## Motor de audio

El motor usa una voz compartida por nota: todos sus parciales pasan por un único filtro, paneo y bloque de envíos. Esto reduce el costo de cada pulsación sin quitarle a cada parcial su afinación, envolvente, FM o desafinación.

- Polifonía máxima de 28 voces, con voice stealing y fade corto para evitar clicks.
- Parciales por encima del límite útil del sample rate se descartan para reducir aliasing.
- El ruido de ataque reutiliza un buffer común en vez de generarlo para cada nota.
- Ganancia normalizada según la energía de los parciales de cada plantilla.
- Cadena master con filtro DC, compresor, saturación suave con oversampling y volumen perceptual.
- Reverb convolucional normalizada con pre-delay y delay filtrado con feedback estable.
- Cambios de volumen, mute, reverb y delay suavizados para evitar saltos audibles.
- Validación defensiva del JSON: valores ausentes reciben defaults, IDs duplicados se ignoran y plantillas sin parciales válidos no se cargan.

## Entorno

La ciudad de fondo es pixel-art generativa — reacciona a la hora local y al clima real via [Open-Meteo](https://open-meteo.com/). Las luces de los edificios altos parpadean para avisos a aeronaves. De noche hay estrellas. Con lluvia activada aparecen las gotas sobre los techos. La fauna usa sprites pixel-art generados para BRISYNTH y funciona como un secuenciador aleatorio sobre las cuerdas.

## Stack

- [Three.js](https://threejs.org/) — escena 3D, físicas de cuerdas, `TubeGeometry`, raycasting para interacción
- Web Audio API — síntesis declarativa aditiva, FM y sustractiva, reverb convolucional, delay con feedback y dron eólico
- Canvas 2D — ciudad pixel-art determinista (resolución interna 320×180, escalada `pixelated`)
- Open-Meteo — clima real sin API key
- [Vite](https://vitejs.dev/) — build

## Demo

[vlasvlasvlas.github.io/brisynth](https://vlasvlasvlas.github.io/brisynth)
