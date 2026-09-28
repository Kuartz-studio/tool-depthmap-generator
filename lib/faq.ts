// Shown in the guide and mirrored in the FAQPage structured data: keep both in sync.
export const faq = [
  {
    q: 'Mes images sont-elles envoyées sur un serveur ?',
    a: "Non. Tout se passe dans ton navigateur : l'image ne quitte jamais ta machine. Pour le calcul, seuls le moteur ONNX Runtime et les fichiers du modèle sont téléchargés (depuis jsDelivr et Hugging Face), une seule fois, puis gardés en cache.",
  },
  {
    q: 'Kuartz Depth est-il vraiment gratuit ?',
    a: 'Oui : gratuit, sans compte, sans limite et sans filigrane. Le code source est ouvert, sous licence MIT, sur GitHub.',
  },
  {
    q: 'Faut-il une carte graphique puissante ?',
    a: "Non. Si ton navigateur prend en charge WebGPU, le calcul passe par la carte graphique ; sinon il tourne sur le processeur en WebAssembly, plus lentement. Le moteur utilisé s'affiche en haut à droite de l'outil.",
  },
  {
    q: 'Dans une depth map, le blanc est-il proche ou lointain ?',
    a: "Par défaut, le blanc est proche et le noir lointain : c'est la convention attendue par la plupart des effets de parallaxe et de displacement. L'option « Inverser » donne la convention opposée.",
  },
  {
    q: 'Quelle résolution pour la depth map exportée ?',
    a: "La taille de ton image d'origine, ou une version réduite à 4096, 2048 ou 1024 px. En qualité « Haute déf. », l'image est aussi analysée par tuiles pour garder le détail des grandes images.",
  },
  {
    q: 'Puis-je utiliser les depth maps dans un projet commercial ?',
    a: "Les modèles proposés ici sont publiés sous licence Apache-2.0, qui autorise l'usage commercial. Si tu charges ton propre modèle .onnx, vérifie sa licence.",
  },
  {
    q: 'Comment créer un effet parallaxe 3D avec la depth map ?',
    a: "Vérifie le rendu dans l'aperçu « Relief 3D », exporte la depth map, puis reprends le code de la section « Intégration WebGL (OGL) » : c'est le même shader de parallaxe, avec gestion de l'occlusion, prêt à intégrer dans un site.",
  },
  {
    q: 'Quels navigateurs sont compatibles ?',
    a: "Les versions récentes de Chrome, Edge, Firefox et Safari. WebGPU accélère le calcul là où il est disponible et l'aperçu utilise WebGL 2 ; sans WebGL 2, le calcul et l'export fonctionnent quand même.",
  },
] as const;
