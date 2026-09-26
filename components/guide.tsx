import Image from 'next/image';
import photo from '@/assets/depth-map-exemple-photo.jpg';
import depthMap from '@/assets/depth-map-exemple.png';
import { faq } from '@/lib/faq';

const steps = [
  {
    title: 'Importe ton image',
    text: "Clique sur « Importer des images », glisse-dépose tes fichiers ou colle une image avec Ctrl/Cmd + V. Tu peux en charger plusieurs et tout calculer d'un coup.",
  },
  {
    title: 'Génère la profondeur',
    text: 'Choisis un modèle et une qualité (Rapide, Précis ou Haute déf.), puis lance le calcul. Le modèle se télécharge une seule fois, puis reste en cache.',
  },
  {
    title: 'Affine le résultat',
    text: 'Accroche la profondeur aux contours, lisse les surfaces, règle le plan lointain et le plan proche, la courbe, ou des paliers pour un découpage 2,5D.',
  },
  {
    title: 'Exporte',
    text: 'Télécharge en PNG 16 bits, PNG 8 bits, WebGL RG ou normal map, exporte tout en .zip, ou copie la depth map pour la coller dans Figma.',
  },
];

const uses = [
  {
    title: 'Parallaxe 3D sur un site',
    text: "Fais bouger une photo en relief au survol de la souris. L'intégration WebGL (OGL) fournie reprend le shader de l'aperçu Relief 3D.",
  },
  {
    title: 'Motion design et 3D',
    text: "En PNG 16 bits, sans effet d'escalier, la depth map sert de displacement dans Blender ou de calque de profondeur dans After Effects et TouchDesigner.",
  },
  {
    title: 'Flou de profondeur',
    text: "Utilise-la comme carte de profondeur pour simuler un flou d'objectif réaliste dans Photoshop ou en compositing.",
  },
  {
    title: 'Éclairage en shader',
    text: 'La normal map calculée depuis la profondeur (convention OpenGL) permet de ré-éclairer une image en temps réel.',
  },
];

const models = [
  {
    name: 'Depth Anything V2 Small',
    size: '27 à 99 Mo',
    note: 'Le choix fiable par défaut : rapide, net, utilisable en projet client.',
  },
  {
    name: 'Depth Anything 3 Small',
    size: '106 Mo',
    note: 'Dernière génération, géométrie plus juste. Expérimental dans le navigateur.',
  },
  {
    name: 'Depth Anything 3 Base',
    size: '413 Mo',
    note: 'La meilleure qualité proposée, pour une machine récente avec un bon GPU.',
  },
];

// Indexable content below the tool: what a depth map is, how to make one, FAQ.
export function Guide() {
  return (
    <article className="guide" id="guide" aria-labelledby="guide-title">
      <div className="guide-wrap">
        <header className="guide-intro">
          <p className="guide-eyebrow">Guide</p>
          <h2 id="guide-title">Créer une depth map à partir d'une image, gratuitement</h2>
          <p className="guide-lead">
            Kuartz Depth calcule la carte de profondeur (depth map) de n'importe quelle photo, rendu 3D ou
            illustration. Les modèles d'IA Depth Anything tournent directement dans ton navigateur, sur ta carte
            graphique (WebGPU) ou ton processeur (WebAssembly) : ton image n'est jamais envoyée sur un serveur, et il
            n'y a ni compte à créer ni filigrane.
          </p>
        </header>

        <section className="guide-section" aria-labelledby="guide-steps">
          <h2 id="guide-steps">Générer une depth map en 4 étapes</h2>
          <ol className="guide-grid guide-grid-4">
            {steps.map((step, i) => (
              <li key={step.title} className="guide-card">
                <span className="guide-num mono" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="guide-section guide-split" aria-labelledby="guide-what">
          <div>
            <h2 id="guide-what">Qu'est-ce qu'une depth map ?</h2>
            <p>
              Une depth map, ou carte de profondeur, est une image en niveaux de gris où chaque pixel indique la
              distance entre la caméra et la scène. Par défaut, le blanc correspond aux zones proches et le noir aux
              zones lointaines.
            </p>
            <p>
              Depth Anything estime cette profondeur à partir d'une seule image, sans capteur 3D ni paire stéréo :
              c'est de l'estimation de profondeur monoculaire. La depth map sert ensuite de base à un effet de
              parallaxe, à un displacement ou à un flou de profondeur.
            </p>
          </div>
          <figure className="guide-figure">
            <div className="guide-pair">
              <Image
                src={photo}
                alt="Rendu 3D : une sphère bleue, un cylindre turquoise, un tore blanc, une petite sphère pêche et un cube jaune sur fond gris clair"
                sizes="(max-width: 1020px) 50vw, 280px"
                placeholder="blur"
              />
              <Image
                src={depthMap}
                alt="Depth map de la même scène en niveaux de gris : le sol au premier plan est blanc, le fond lointain est noir"
                sizes="(max-width: 1020px) 50vw, 280px"
                placeholder="blur"
              />
            </div>
            <figcaption>Une scène 3D et sa depth map calculée par Depth Anything V2 : plus c'est clair, plus c'est proche.</figcaption>
          </figure>
        </section>

        <section className="guide-section" aria-labelledby="guide-uses">
          <h2 id="guide-uses">À quoi sert une depth map ?</h2>
          <ul className="guide-grid guide-grid-2">
            {uses.map((use) => (
              <li key={use.title} className="guide-card">
                <h3>{use.title}</h3>
                <p>{use.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="guide-section" aria-labelledby="guide-models">
          <h2 id="guide-models">Quel modèle choisir ?</h2>
          <div className="guide-table-wrap">
            <table className="guide-table">
              <thead>
                <tr>
                  <th scope="col">Modèle</th>
                  <th scope="col">Téléchargement</th>
                  <th scope="col">Pour qui</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.name}>
                    <th scope="row">{model.name}</th>
                    <td className="mono">{model.size}</td>
                    <td>{model.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="guide-note">
            Les trois modèles sont publiés sous licence Apache-2.0. Tu peux aussi charger ton propre modèle au format
            .onnx depuis les options avancées.
          </p>
        </section>

        <section className="guide-section" aria-labelledby="guide-faq">
          <h2 id="guide-faq">Questions fréquentes</h2>
          <div className="guide-grid guide-grid-2">
            {faq.map((item) => (
              <div key={item.q} className="guide-card">
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </article>
  );
}
