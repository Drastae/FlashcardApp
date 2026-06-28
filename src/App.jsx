import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialisation du client Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const PIXABAY_API_KEY = import.meta.env.VITE_PIXABAY_API_KEY;

const LANGUAGES = [
  { id: 'en', name: 'Anglais', flag: 'EN', locale: 'en-US', gradient: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)' },
  { id: 'nl', name: 'Néerlandais', flag: 'NL', locale: 'nl-NL', gradient: 'linear-gradient(135deg, #c2410c 0%, #f97316 100%)' },
  { id: 'de', name: 'Allemand', flag: 'DE', locale: 'de-DE', gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)' }
];

export default function App() {
  // --- ÉTAT DU THÈME (DARK MODE) ---
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('fc_dark_mode') === 'true';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('fc_dark_mode', darkMode);
  }, [darkMode]);

  // --- ÉTAT DE LA LANGUE ---
  const [selectedLang, setSelectedLang] = useState(() => {
    return localStorage.getItem('fc_selected_lang') || null;
  });

  // --- ÉTAT DE L'ONGLET ACTIF ---
  const [activeTab, setActiveTab] = useState('review');

  useEffect(() => {
    if (selectedLang) {
      localStorage.setItem('fc_selected_lang', selectedLang);
    } else {
      localStorage.removeItem('fc_selected_lang');
    }
  }, [selectedLang]);

  // --- ÉTATS DES DONNÉES ---
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchScoresAndCards = async () => {
    if (!selectedLang) return;
    setLoading(true);
    
    const { data: fetchedCards, error } = await supabase
      .from('cards')
      .select('*')
      .eq('lang', selectedLang)
      .order('id', { ascending: false });

    if (!error && fetchedCards) setCards(fetchedCards);
    setLoading(false);
  };

  useEffect(() => {
    fetchScoresAndCards();
  }, [selectedLang]);

  // --- ÉTATS INTERFACE DE RÉVISION ---
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  
  const [userAnswer, setUserAnswer] = useState('');
  const [isCorrect, setIsCorrect] = useState(false);
  const [inputFeedback, setInputFeedback] = useState('neutral'); // neutral, partial-correct, incorrect
  const [triggerSuccessAnim, setTriggerSuccessAnim] = useState(false);

  // Formulaires & Médias
  const [wordInput, setWordInput] = useState('');
  const [translationInput, setTranslationInput] = useState('');
  const [typeInput, setTypeInput] = useState('n.');
  const [contextInput, setContextInput] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [editingId, setEditingId] = useState(null);

  // Recherche API Médias
  const [searchQuery, setSearchQuery] = useState('');
  const [apiImages, setApiImages] = useState([]);
  const [searchingImages, setSearchingImages] = useState(false);

  // État pour la modale de consultation
  const [viewingMasteredItem, setViewingMasteredItem] = useState(null);
  const [isMasteredFlipped, setIsMasteredFlipped] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const currentLangConfig = LANGUAGES.find(l => l.id === selectedLang);
  const todayStr = new Date().toISOString().split('T')[0];
  
  const reviewableCards = cards.filter(card => {
    if (!card.next_review) return true;
    return card.next_review <= todayStr;
  });

  const masteredWords = cards.filter(card => card.interval >= 21);
  const activeCard = reviewableCards[currentCardIndex];
  const firstLetterHint = activeCard && activeCard.word ? activeCard.word.trim().charAt(0).toUpperCase() : '';

  // --- SYNTHÈSE VOCALE ---
  const speakWord = (text, e) => {
    if (e) e.stopPropagation();
    if (!window.speechSynthesis || !currentLangConfig) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = currentLangConfig.locale;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  // --- RECHERCHE AUTOMATIQUE D'IMAGES (PIXABAY) ---
  const searchOnlineImages = async (query) => {
    if (!query.trim() || !PIXABAY_API_KEY) return;
    setSearchingImages(true);
    try {
      const response = await fetch(
        `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&per_page=6`
      );
      const data = await response.json();
      if (data.hits) {
        setApiImages(data.hits.map(hit => hit.webformatURL));
      }
    } catch (error) {
      console.error("Erreur de recherche d'images:", error);
    } finally {
      setSearchingImages(false);
    }
  };

  const handlePixabayKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchOnlineImages(searchQuery);
    }
  };

  // --- TELEVERSEMENT FICHIER LOCAL (SUPABASE STORAGE) ---
  const handleLocalFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `${selectedLang}/${fileName}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('flashcards-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('flashcards-images')
        .getPublicUrl(filePath);

      if (data?.publicUrl) {
        setImageUrlInput(data.publicUrl);
      }
    } catch (error) {
      console.error("Échec de l'upload de l'image:", error);
    } finally {
      setUploading(false);
    }
  };

  // --- VÉRIFICATION DE LA RÉPONSE & FEEDBACK MICRO-INTERACTIONS ---
  useEffect(() => {
    if (!activeCard) {
      setIsCorrect(false);
      setInputFeedback('neutral');
      return;
    }
    const cleanUser = userAnswer.trim().toLowerCase();
    const cleanTarget = activeCard.word.trim().toLowerCase();
    
    if (cleanUser.length === 0) {
      setInputFeedback('neutral');
      setIsCorrect(false);
      return;
    }

    if (cleanUser === cleanTarget) {
      setIsCorrect(true);
      setInputFeedback('partial-correct');
      setTriggerSuccessAnim(true);
      const timer = setTimeout(() => setTriggerSuccessAnim(false), 600);
      return () => clearTimeout(timer);
    } else if (cleanTarget.startsWith(cleanUser)) {
      setInputFeedback('partial-correct');
      setIsCorrect(false);
    } else {
      setInputFeedback('incorrect');
      setIsCorrect(false);
    }
  }, [userAnswer, activeCard]);

  const resetVerification = () => {
    setUserAnswer('');
    setIsCorrect(false);
    setInputFeedback('neutral');
    setIsFlipped(false);
  };

  // --- ALGORITHME DE RÉPÉTITION ESPACÉE ANKI (SM-2) ---
  const handleReviewScore = async (performance) => {
    if (!activeCard) return;

    let repetitions = activeCard.repetitions ?? 0;
    let interval = activeCard.interval ?? 0;
    let easeFactor = activeCard.ease_factor ?? 2.5;

    let q = 4;
    if (performance === 'hard') q = 2;
    if (performance === 'medium') q = 4;
    if (performance === 'easy') q = 5;

    easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    if (q < 3) {
      repetitions = 0;
      interval = 1;
    } else {
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions++;
    }

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + interval);
    const nextReviewStr = targetDate.toISOString().split('T')[0];

    await supabase
      .from('cards')
      .update({ 
        next_review: nextReviewStr, 
        repetitions: repetitions,
        interval: interval,
        ease_factor: easeFactor
      })
      .eq('id', activeCard.id);

    resetVerification();
    await fetchScoresAndCards();
    adjustActiveIndexAfterRemoval(reviewableCards.length - 1);
  };

  const adjustActiveIndexAfterRemoval = (remainingCount) => {
    if (currentCardIndex >= remainingCount && remainingCount > 0) {
      setCurrentCardIndex(remainingCount - 1);
    } else if (remainingCount === 0) {
      setCurrentCardIndex(0);
    }
  };

  // --- ACTIONS DU FORMULAIRE ---
  const handleAddOrUpdate = async (e) => {
    e.preventDefault();
    if (!wordInput.trim() || !translationInput.trim()) return;

    if (editingId) {
      await supabase
        .from('cards')
        .update({ word: wordInput, translation: translationInput, type: typeInput, context: contextInput, image_url: imageUrlInput })
        .eq('id', editingId);
      setEditingId(null);
    } else {
      await supabase
        .from('cards')
        .insert([{ 
          word: wordInput, 
          translation: translationInput, 
          type: typeInput, 
          context: contextInput, 
          image_url: imageUrlInput, 
          lang: selectedLang,
          repetitions: 0,
          interval: 0,
          ease_factor: 2.5,
          next_review: todayStr
        }]);
      setCurrentPage(1);
    }
    setWordInput('');
    setTranslationInput('');
    setContextInput('');
    setImageUrlInput('');
    setSearchQuery('');
    setApiImages([]);
    setTypeInput('n.');
    await fetchScoresAndCards();
  };

  const handleEdit = (card) => {
    setEditingId(card.id);
    setWordInput(card.word);
    setTranslationInput(card.translation);
    setTypeInput(card.type || 'n.');
    setContextInput(card.context || '');
    setImageUrlInput(card.image_url || '');
  };

  const handleDelete = async (id) => {
    await supabase.from('cards').delete().eq('id', id);
    resetVerification();
    await fetchScoresAndCards();

    const totalPagesAfterDelete = Math.ceil((cards.length - 1) / itemsPerPage);
    if (currentPage > totalPagesAfterDelete && totalPagesAfterDelete > 0) {
      setCurrentPage(totalPagesAfterDelete);
    }
  };

  const nextCard = () => {
    resetVerification();
    setTimeout(() => {
      setCurrentCardIndex((prev) => (prev + 1) % reviewableCards.length);
    }, 150);
  };

  // --- PAGINATION ---
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentCards = cards.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(cards.length / itemsPerPage);

  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  // --- ÉCRAN 1 : CHOIX DE LA LANGUE ---
  if (!selectedLang) {
    return (
      <div className="container py-5 min-h-screen d-flex flex-column justify-content-center align-items-center">
        <div className="position-absolute top-0 end-0 m-3">
          <button onClick={() => setDarkMode(!darkMode)} className="btn btn-outline-secondary rounded-circle px-2 py-1.5">
            {darkMode ? <i className="bi bi-sun-fill"></i> : <i className="bi bi-moon-fill"></i>}
          </button>
        </div>
        <div className="text-center mb-5">
          <h1 className="display-5 fw-extrabold mb-2">Vocabulaire & Flashcards</h1>
          <p className="text-muted fs-5">Choisissez la langue que vous souhaitez réviser ou enrichir aujourd'hui</p>
        </div>
        <div className="row g-4 w-100 max-w-md justify-content-center">
          {LANGUAGES.map((lang) => (
            <div key={lang.id} className="col-12">
              <button
                onClick={() => {
                  setSelectedLang(lang.id);
                  setCurrentCardIndex(0);
                  setActiveTab('review');
                  resetVerification();
                }}
                className="btn w-100 p-4 rounded-4 shadow-sm text-white text-start d-flex align-items-center justify-content-between border-0 transition-transform"
                style={{ background: lang.gradient, transform: 'scale(1)', transition: 'transform 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div className="d-flex align-items-center gap-3">
                  <span className="badge bg-white bg-opacity-25 fs-5 px-3 py-2 rounded-3 font-monospace fw-bold">{lang.flag}</span>
                  <span className="fs-4 fw-bold">{lang.name}</span>
                </div>
                <i className="bi bi-arrow-right-circle fs-3 opacity-75"></i>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- ÉCRAN 2 : INTERFACE PRINCIPALE ---
  return (
    <div className="container py-4 pb-5 mb-5 mb-md-0">
      {/* Styles d'animation CSS 3D & Micro-interactions */}
      <style>{`
        @keyframes pulse-success {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(25, 135, 84, 0.7); }
          50% { transform: scale(1.03); box-shadow: 0 0 0 15px rgba(25, 135, 84, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(25, 135, 84, 0); }
        }
        .anim-success { animation: pulse-success 0.6s ease-out; }

        /* PERSPECTIVE & CONTAINER FLIP 3D */
        .flip-container {
          perspective: 1000px;
          width: 100%;
          min-height: 340px;
        }
        .flip-card-inner {
          position: relative;
          width: 100%;
          height: 100%;
          text-align: center;
          transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
          transform-style: preserve-3d;
        }
        .flip-container.flipped .flip-card-inner {
          transform: rotateY(180deg);
        }
        .flip-card-front, .flip-card-back {
          position: absolute;
          width: 100%;
          height: 100%;
          min-height: 340px;
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
          border-radius: 1.5rem;
          padding: 2rem;
          display: flex;
          flex-column;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
        }
        .flip-card-back {
          transform: rotateY(180deg);
        }

        /* STICKY BOTTOM SUR MOBILE */
        @media (max-width: 767.98px) {
          .mobile-sticky-actions {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(var(--bs-body-bg-rgb), 0.85);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            padding: 1rem;
            box-shadow: 0 -0.5rem 1.5rem rgba(0,0,0,0.1);
            z-index: 1030;
          }
        }

        /* MICRO-INTERACTIONS BORDURES Saisie */
        .feedback-neutral { border: 2px solid transparent !important; }
        .feedback-partial-correct { border: 2px solid #198754 !important; box-shadow: 0 0 0 0.25rem rgba(25, 135, 84, 0.25) !important; }
        .feedback-incorrect { border: 2px solid #dc3545 !important; box-shadow: 0 0 0 0.25rem rgba(220, 53, 69, 0.25) !important; }
      `}</style>

      {/* Navigation supérieure adaptative mobile */}
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3 mb-4 bg-body-tertiary p-3 rounded-4 shadow-sm">
        <div className="d-flex align-items-center justify-content-between w-100 w-md-auto">
          <div className="d-flex align-items-center gap-3">
            <span className="badge bg-secondary bg-opacity-10 text-secondary fs-6 px-2.5 py-1.5 rounded-2 font-monospace fw-bold">{currentLangConfig?.flag}</span>
            <h1 className="h4 mb-0 fw-bold">Espace {currentLangConfig?.name}</h1>
          </div>
          <button onClick={() => setDarkMode(!darkMode)} className="btn btn-outline-secondary rounded-circle px-2 py-1.5 d-md-none ms-2">
            {darkMode ? <i className="bi bi-sun-fill"></i> : <i className="bi bi-moon-fill"></i>}
          </button>
        </div>
        
        <div className="btn-group w-100 w-md-auto shadow-sm" role="group">
          <button 
            type="button" 
            className={`btn px-3 px-sm-4 ${activeTab === 'review' ? 'btn-primary' : 'btn-light'}`}
            onClick={() => setActiveTab('review')}
          >
            <i className="bi bi-play-circle me-2"></i><span className="d-none d-sm-inline">Mode </span>Révision
          </button>
          <button 
            type="button" 
            className={`btn px-3 px-sm-4 ${activeTab === 'manage' ? 'btn-primary' : 'btn-light'}`}
            onClick={() => setActiveTab('manage')}
          >
            <i className="bi bi-gear-fill me-2"></i>Gestion<span className="d-none d-sm-inline"> Vocabulaire</span>
          </button>
        </div>

        <div className="d-flex gap-2 w-100 w-md-auto">
          <button onClick={() => setSelectedLang(null)} className="btn btn-outline-secondary rounded-3 d-flex align-items-center justify-content-center gap-2 flex-grow-1">
            <i className="bi bi-arrow-left"></i> Changer de langue
          </button>
          <button onClick={() => setDarkMode(!darkMode)} className="btn btn-outline-secondary rounded-circle px-2 py-1.5 d-none d-md-block">
            {darkMode ? <i className="bi bi-sun-fill"></i> : <i className="bi bi-moon-fill"></i>}
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center my-3 text-secondary">
          <div className="spinner-border spinner-border-sm me-2" role="status"></div>
          Synchronisation avec la base de données...
        </div>
      )}

      {/* VUE 1 : MODE RÉVISION ACTIVE */}
      {activeTab === 'review' && (
        <div className="row g-4">
          <div className="col-12 col-lg-8">
            <div className="card shadow-sm border-0 rounded-4 mb-4">
              <div className="card-body p-4">
                <h2 className="h5 card-title mb-4 text-secondary d-flex align-items-center justify-content-between">
                  <span><i className="bi bi-book text-primary me-2"></i>Révision active</span>
                  <span className="badge bg-secondary rounded-pill fs-6 fw-normal">À réviser : {reviewableCards.length}</span>
                </h2>

                {reviewableCards.length > 0 ? (
                  <div>
                    {/* CONTENEUR ANIMATION FLIP 3D */}
                    <div className={`flip-container mb-4 ${isFlipped ? 'flipped' : ''}`}>
                      <div className="flip-card-inner">
                        
                        {/* RECTO : MOT FRANÇAIS */}
                        <div 
                          className={`flip-card-front text-white flex-column ${triggerSuccessAnim ? 'anim-success' : ''}`}
                          style={{ background: currentLangConfig?.gradient }}
                        >
                          <div className="d-flex align-items-center justify-content-between w-100">
                            <span className="text-uppercase tracking-wider small opacity-75 fw-bold">Mot Français</span>
                            <span className="badge bg-white bg-opacity-25 text-white rounded-pill font-monospace">{activeCard.type || 'n.'}</span>
                          </div>
                          <div className="my-3 w-100 text-center">
                            <p className="display-6 fw-bold mb-0">{activeCard.translation}</p>
                          </div>
                          <span className="badge bg-white bg-opacity-10 text-white rounded-pill px-3 py-2 small border-0 opacity-75">
                            <i className="bi bi-lock-fill me-1"></i> Saisissez la traduction correcte
                          </span>
                        </div>

                        {/* VERSO : MOT TRADUIT & DETAILS */}
                        <div 
                          onClick={() => isCorrect && setIsFlipped(!isFlipped)}
                          className="flip-card-back text-white flex-column"
                          style={{ background: 'linear-gradient(135deg, #198754 0%, #157347 100%)', cursor: 'pointer' }}
                        >
                          <div className="d-flex align-items-center justify-content-between w-100">
                            <span className="text-uppercase tracking-wider small opacity-75 fw-bold">Traduction validée !</span>
                            {activeCard.interval > 0 && (
                              <span className="badge bg-dark bg-opacity-50 text-white rounded-pill small">
                                <i className="bi bi-hourglass-split me-1"></i>Intervalle : {activeCard.interval}j
                              </span>
                            )}
                          </div>
                          <div className="my-2 w-100 text-center">
                            <div className="d-flex align-items-center justify-content-center gap-2">
                              <p className="display-6 fw-bold mb-0">{activeCard.word}</p>
                              <button 
                                onClick={(e) => speakWord(activeCard.word, e)} 
                                className="btn btn-light btn-sm rounded-circle px-2.5 py-1.5 shadow-sm text-dark border-0 ms-2"
                              >
                                <i className="bi bi-volume-up-fill fs-5"></i>
                              </button>
                            </div>
                            
                            <div className="row justify-content-center align-items-center mt-3 g-3 max-w-lg mx-auto">
                              {activeCard.image_url && (
                                <div className="col-5">
                                  <img src={activeCard.image_url} alt="" className="img-fluid rounded-3 shadow-sm border border-white border-opacity-25" style={{ maxHeight: '90px', objectFit: 'cover', width: '100%' }} />
                                </div>
                              )}
                              <div className={activeCard.image_url ? "col-7 text-start" : "col-12"}>
                                {activeCard.context ? (
                                  <div className="p-2 bg-white bg-opacity-10 rounded-3 border border-white border-opacity-10">
                                    <p className="fst-italic mb-0 small" style={{ fontSize: '0.85rem' }}>{activeCard.context}</p>
                                  </div>
                                ) : (
                                  <p className="small text-white opacity-50 mb-0 fst-italic">Aucun contexte configuré.</p>
                                )}
                              </div>
                            </div>
                          </div>
                          <span className="badge bg-white text-success rounded-pill px-3 py-2 btn btn-sm border-0 shadow-sm fw-bold">
                            <i className="bi bi-arrow-clockwise me-1"></i> Cliquer pour masquer
                          </span>
                        </div>

                      </div>
                    </div>

                    {/* CHAMP DE SAISIE AVEC MICRO-INTERACTIONS FLUIDES */}
                    <div className="mb-4">
                      <div className="input-group input-group-lg shadow-sm rounded-3 overflow-hidden">
                        <span className={`input-group-text border-0 text-white transition-colors ${isCorrect ? 'bg-success' : 'bg-secondary bg-opacity-25 text-body'}`}>
                          {isCorrect ? <i className="bi bi-check-lg"></i> : <i className="bi bi-pencil-square"></i>}
                        </span>
                        <input 
                          type="text"
                          placeholder={isCorrect ? "Trouvé !" : `Commence par : "${firstLetterHint}"...`}
                          value={userAnswer}
                          onChange={(e) => setUserAnswer(e.target.value)}
                          className={`form-control bg-body-tertiary transition-all ${isCorrect ? 'fw-bold text-success' : ''} ${
                            inputFeedback === 'partial-correct' ? 'feedback-partial-correct' : 
                            inputFeedback === 'incorrect' ? 'feedback-incorrect' : 'feedback-neutral'
                          }`}
                          disabled={isCorrect && isFlipped}
                        />
                      </div>
                    </div>

                    {/* COMPORTEMENT DES BOUTONS ET CONTRAINTE STICKY MOBILE */}
                    <div className="mobile-sticky-actions">
                      <div className="d-flex flex-wrap gap-2 align-items-center max-w-lg mx-auto">
                        <div className="d-flex gap-2 flex-grow-1">
                          <button onClick={() => handleReviewScore('hard')} className="btn btn-danger flex-grow-1 py-2.5 rounded-3 fw-medium shadow-sm" disabled={!isCorrect}>
                            Revoir <span className="d-block small opacity-75 fw-normal">(1 jour)</span>
                          </button>
                          <button onClick={() => handleReviewScore('medium')} className="btn btn-warning text-dark flex-grow-1 py-2.5 rounded-3 fw-medium shadow-sm" disabled={!isCorrect}>
                            Correct <span className="d-block small opacity-75 fw-normal">({activeCard.repetitions <= 1 ? '6 j.' : 'Étalé'})</span>
                          </button>
                          <button onClick={() => handleReviewScore('easy')} className="btn btn-success flex-grow-1 py-2.5 rounded-3 fw-medium shadow-sm" disabled={!isCorrect}>
                            Facile <span className="d-block small opacity-75 fw-normal">(Bonus)</span>
                          </button>
                        </div>
                        {reviewableCards.length > 1 && (
                          <button onClick={nextCard} className="btn btn-outline-secondary px-4 py-2.5 rounded-3 w-100 w-sm-auto">Passer</button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-5 text-center border rounded-4 border-dashed bg-body-tertiary text-muted">
                    <p className="fw-medium mb-1"><i className="bi bi-calendar-check text-success h4 d-block mb-2"></i>Tout est à jour pour cette langue !</p>
                    <p className="small mb-0">Revenez demain ou ajoutez de nouveaux termes dans l'onglet de gestion.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-4">
            <div className="card shadow-sm border-0 rounded-4 sticky-top" style={{ top: '6rem' }}>
              <div className="card-body p-4">
                <h2 className="h5 card-title mb-4 text-secondary d-flex align-items-center gap-2">
                  <i className="bi bi-check-circle-fill text-success"></i> Long Terme ({masteredWords.length})
                </h2>
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 16rem)' }}>
                  <ul className="list-group list-group-flush gap-2">
                    {masteredWords.map((item) => (
                      <li 
                        key={item.id} 
                        onClick={() => {
                          setViewingMasteredItem(item);
                          setIsMasteredFlipped(false);
                        }}
                        className="list-group-item d-flex justify-content-between align-items-center bg-success bg-opacity-10 border border-success border-opacity-10 rounded-3 p-3 transition-colors"
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="d-flex align-items-center gap-2">
                          {item.image_url && <img src={item.image_url} alt="" className="rounded-2 border" style={{ width: '40px', height: '40px', objectFit: 'cover' }} />}
                          <div className="d-flex flex-column">
                            <span className="fw-medium text-success">{item.word}</span>
                            <span className="small text-success opacity-75 font-monospace">{item.interval} jours</span>
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          <button onClick={(e) => speakWord(item.word, e)} className="btn btn-sm btn-light rounded-circle text-success px-2 py-1 border-0"><i className="bi bi-volume-up-fill"></i></button>
                          <span className="badge bg-success rounded-pill px-2.5 py-1.5 small fw-semibold">Voir</span>
                        </div>
                      </li>
                    ))}
                    {masteredWords.length === 0 && (
                      <p className="text-center text-muted small py-4">Aucune carte acquise à long terme.</p>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VUE 2 : GESTION DU VOCABULAIRE */}
      {activeTab === 'manage' && (
        <div className="card shadow-sm border-0 rounded-4">
          <div className="card-body p-4">
            <h3 className="h5 card-title mb-4 text-secondary">{editingId ? 'Modifier le mot' : 'Ajouter un nouveau mot'}</h3>
            
            <form onSubmit={handleAddOrUpdate} className="row g-3 mb-4">
              <div className="col-md-5">
                <label className="form-label small text-muted fw-bold">Mot traduit ({currentLangConfig?.name})</label>
                <input type="text" placeholder="ex: Scarcity" value={wordInput} onChange={(e) => setWordInput(e.target.value)} className="form-control py-2.5 bg-body-tertiary border-0 rounded-3" />
              </div>
              <div className="col-md-5">
                <label className="form-label small text-muted fw-bold">Traduction (Français)</label>
                <input type="text" placeholder="ex: Rareté" value={translationInput} onChange={(e) => setTranslationInput(e.target.value)} className="form-control py-2.5 bg-body-tertiary border-0 rounded-3" />
              </div>
              <div className="col-md-2">
                <label className="form-label small text-muted fw-bold">Nature</label>
                <select value={typeInput} onChange={(e) => setTypeInput(e.target.value)} className="form-select py-2.5 bg-body-tertiary border-0 rounded-3 text-secondary fw-medium">
                  <option value="n.">Nom (n.)</option>
                  <option value="v.">Verbe (v.)</option>
                  <option value="adj.">Adjectif (adj.)</option>
                  <option value="adv.">Adverbe (adv.)</option>
                  <option value="exp.">Expression (exp.)</option>
                </select>
              </div>
              <div className="col-12">
                <label className="form-label small text-muted fw-bold">Exemple ou contexte d'utilisation</label>
                <textarea rows="2" placeholder="Saisissez une phrase d'exemple..." value={contextInput} onChange={(e) => setContextInput(e.target.value)} className="form-control bg-body-tertiary border-0 rounded-3"></textarea>
              </div>

              {/* MODULE DES IMAGES */}
              <div className="col-12 border rounded-3 p-3 bg-body-tertiary bg-opacity-50">
                <label className="form-label small text-secondary fw-bold mb-3 d-block"><i className="bi bi-image me-2"></i>Illustration de la carte (Optionnel)</label>
                <div className="row g-3">
                  <div className="col-md-6 border-end">
                    <span className="d-block small text-muted fw-medium mb-2">Option A : Importer depuis votre PC</span>
                    <input type="file" accept="image/*" onChange={handleLocalFileUpload} className="form-control btn-sm bg-body" />
                    {uploading && <div className="small text-primary mt-1"><span className="spinner-border spinner-border-sm me-1"></span>Upload en cours...</div>}
                  </div>
                  <div className="col-md-6">
                    <span className="d-block small text-muted fw-medium mb-2">Option B : Rechercher sur Pixabay</span>
                    <div className="input-group input-group-sm">
                      <input 
                        type="text" 
                        placeholder="Terme en anglais (ex: dog, house...)" 
                        value={searchQuery} 
                        onChange={(e) => setSearchQuery(e.target.value)} 
                        onKeyDown={handlePixabayKeyDown}
                        className="form-control border bg-body" 
                      />
                      <button type="button" onClick={() => searchOnlineImages(searchQuery)} className="btn btn-outline-secondary">Rechercher</button>
                    </div>
                    {searchingImages && <div className="small text-muted mt-1">Recherche en cours...</div>}
                  </div>
                </div>

                {apiImages.length > 0 && (
                  <div className="mt-3">
                    <span className="d-block small text-muted mb-2">Sélectionnez une image :</span>
                    <div className="row g-2">
                      {apiImages.map((url, index) => (
                        <div key={index} className="col-4 col-sm-2" style={{ cursor: 'pointer' }} onClick={() => setImageUrlInput(url)}>
                          <img src={url} alt="" className={`img-fluid rounded border ${imageUrlInput === url ? 'border-primary border-3' : 'opacity-75'}`} style={{ height: '65px', objectFit: 'cover', width: '100%' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {imageUrlInput && (
                  <div className="mt-3 p-2 bg-body rounded border d-flex align-items-center justify-content-between">
                    <div className="d-flex align-items-center gap-2 overflow-hidden">
                      <img src={imageUrlInput} alt="Sélection" className="rounded border" style={{ width: '45px', height: '45px', objectFit: 'cover' }} />
                      <span className="small text-success text-truncate fw-medium">Image liée avec succès</span>
                    </div>
                    <button type="button" onClick={() => setImageUrlInput('')} className="btn btn-sm btn-outline-danger border-0"><i className="bi bi-trash-fill"></i></button>
                  </div>
                )}
              </div>

              <div className="col-12 d-flex justify-content-end">
                <button type="submit" className="btn btn-primary px-5 py-2.5 rounded-3 shadow-sm w-100 w-sm-auto" disabled={uploading}>
                  {editingId ? 'Mettre à jour le mot' : 'Ajouter aux révisions'}
                </button>
              </div>
            </form>

            {/* VUE TABLEAU : PC / TABLETTE */}
            <div className="table-responsive border rounded-3 mb-3 d-none d-md-block">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light text-uppercase small text-muted">
                  <tr>
                    <th className="px-4 py-3">Aperçu</th>
                    <th className="px-4 py-3">Mot ({currentLangConfig?.name})</th>
                    <th className="px-4 py-3">Nature</th>
                    <th className="px-4 py-3">Traduction (Fr)</th>
                    <th className="px-4 py-3">Intervalle</th>
                    <th className="px-4 py-3 text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentCards.map((card) => (
                    <tr key={card.id}>
                      <td className="px-4 py-3">
                        {card.image_url ? (
                          <img src={card.image_url} alt="" className="rounded border bg-body-tertiary" style={{ width: '40px', height: '40px', objectFit: 'cover' }} />
                        ) : (
                          <div className="bg-body-tertiary text-muted d-flex align-items-center justify-content-center rounded border" style={{ width: '40px', height: '40px', fontSize: '0.8rem' }}><i className="bi bi-image"></i></div>
                        )}
                      </td>
                      <td className="px-4 py-3 fw-medium">
                        <button onClick={() => speakWord(card.word)} className="btn btn-sm btn-link p-0 me-2 text-secondary" title="Écouter"><i className="bi bi-volume-up-fill"></i></button>
                        {card.word}
                      </td>
                      <td className="px-4 py-3 font-monospace">
                        <span className="badge bg-body-tertiary text-secondary border">{card.type || 'n.'}</span>
                      </td>
                      <td className="px-4 py-3 text-secondary">{card.translation}</td>
                      <td className="px-4 py-3 text-secondary small">{card.interval ?? 0} j.</td>
                      <td className="px-4 py-3 text-end">
                        <button onClick={() => handleEdit(card)} className="btn btn-sm btn-light text-primary me-2 rounded-2"><i className="bi bi-pencil"></i></button>
                        <button onClick={() => handleDelete(card.id)} className="btn btn-sm btn-light text-danger rounded-2"><i className="bi bi-trash"></i></button>
                      </td>
                    </tr>
                  ))}
                  {cards.length === 0 && (
                    <tr>
                      <td colSpan="6" className="text-center py-4 text-muted small">Aucun mot enregistré dans cette langue.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* VUE LISTE DE CARTES : MOBILE (MOBILE FIRST) */}
            <div className="d-block d-md-none mb-3">
              {currentCards.map((card) => (
                <div key={card.id} className="card p-3 mb-2 border rounded-3 bg-body shadow-sm">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div className="d-flex align-items-center gap-2">
                      {card.image_url ? (
                        <img src={card.image_url} alt="" className="rounded border bg-body-tertiary" style={{ width: '35px', height: '35px', objectFit: 'cover' }} />
                      ) : (
                        <div className="bg-body-tertiary text-muted d-flex align-items-center justify-content-center rounded border" style={{ width: '35px', height: '35px', fontSize: '0.75rem' }}><i className="bi bi-image"></i></div>
                      )}
                      <div>
                        <span className="fw-bold">{card.word}</span>
                        <span className="badge bg-body-tertiary text-secondary border font-monospace ms-2" style={{ fontSize: '0.7rem' }}>{card.type || 'n.'}</span>
                      </div>
                    </div>
                    <button onClick={() => speakWord(card.word)} className="btn btn-sm btn-light rounded-circle text-secondary"><i className="bi bi-volume-up-fill"></i></button>
                  </div>
                  <div className="small mb-1">
                    <strong className="text-muted">Traduction :</strong> <span className="text-secondary">{card.translation}</span>
                  </div>
                  <div className="small mb-2">
                    <strong className="text-muted">Intervalle :</strong> <span className="text-secondary">{card.interval ?? 0} jours</span>
                  </div>
                  {card.context && (
                    <div className="small text-muted bg-body-tertiary p-2 rounded mb-2 fst-italic">
                      "{card.context}"
                    </div>
                  )}
                  <div className="d-flex justify-content-end gap-2 border-top pt-2">
                    <button onClick={() => handleEdit(card)} className="btn btn-sm btn-outline-primary px-3 rounded-2"><i className="bi bi-pencil me-1"></i> Modifier</button>
                    <button onClick={() => handleDelete(card.id)} className="btn btn-sm btn-outline-danger px-3 rounded-2"><i className="bi bi-trash me-1"></i> Supprimer</button>
                  </div>
                </div>
              ))}
              {cards.length === 0 && (
                <div className="text-center py-4 text-muted small border rounded-3 bg-body">Aucun mot enregistré dans cette langue.</div>
              )}
            </div>

            {totalPages > 1 && (
              <nav className="d-flex flex-column flex-sm-row justify-content-between align-items-center gap-2 px-1">
                <span className="small text-muted">Affichage de {indexOfFirstItem + 1} à {Math.min(indexOfLastItem, cards.length)} sur {cards.length} mots</span>
                <ul className="pagination pagination-sm mb-0">
                  <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                    <button type="button" className="page-link rounded-3 me-1" onClick={() => paginate(currentPage - 1)}>Précédent</button>
                  </li>
                  {[...Array(totalPages)].map((_, i) => (
                    <li key={i} className={`page-item ${currentPage === i + 1 ? 'active' : ''}`}>
                      <button type="button" className="page-link rounded-3 me-1" onClick={() => paginate(i + 1)}>{i + 1}</button>
                    </li>
                  ))}
                  <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                    <button type="button" className="page-link rounded-3" onClick={() => paginate(currentPage + 1)}>Suivant</button>
                  </li>
                </ul>
              </nav>
            )}
          </div>
        </div>
      )}

      {/* MODALE DE CONSULTATION MOTS ACQUIS */}
      {viewingMasteredItem && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setViewingMasteredItem(null)}>
          <div className="modal-dialog modal-dialog-centered mx-3 mx-sm-auto" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content border-0 rounded-4 shadow-lg">
              <div className="modal-header border-0 bg-body-tertiary rounded-top-4 py-3">
                <h5 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <i className="bi bi-eye text-success"></i> Consultation Carte Long Terme
                </h5>
                <button type="button" className="btn-close" onClick={() => setViewingMasteredItem(null)}></button>
              </div>
              <div className="modal-body p-4 text-center">
                <div 
                  onClick={() => setIsMasteredFlipped(!isMasteredFlipped)}
                  className="p-4 rounded-4 text-white mb-3 d-flex flex-column justify-content-between align-items-center shadow-sm"
                  style={{
                    background: isMasteredFlipped 
                      ? 'linear-gradient(135deg, #198754 0%, #157347 100%)' 
                      : currentLangConfig?.gradient,
                    minHeight: '280px',
                    cursor: 'pointer'
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-uppercase tracking-wider small opacity-75 fw-bold">
                      {isMasteredFlipped ? 'Traduction & Contexte' : `Mot ${currentLangConfig?.name}`}
                    </span>
                    <span className="badge bg-white bg-opacity-25 text-white rounded-pill font-monospace">
                      {viewingMasteredItem.type || 'n.'}
                    </span>
                  </div>

                  <div className="my-2 w-100">
                    <div className="d-flex align-items-center justify-content-center gap-2 mb-2">
                      <p className="display-6 fw-bold mb-0">
                        {isMasteredFlipped ? viewingMasteredItem.translation : viewingMasteredItem.word}
                      </p>
                      {!isMasteredFlipped && (
                        <button 
                          onClick={(e) => speakWord(viewingMasteredItem.word, e)} 
                          className="btn btn-light btn-sm rounded-circle px-2.5 py-1.5 shadow-sm text-dark border-0 ms-2"
                        >
                          <i className="bi bi-volume-up-fill fs-5"></i>
                        </button>
                      )}
                    </div>

                    {isMasteredFlipped && (
                      <div className="row justify-content-center align-items-center g-2 max-w-sm mx-auto mt-2">
                        {viewingMasteredItem.image_url && (
                          <div className="col-5">
                            <img src={viewingMasteredItem.image_url} alt="" className="img-fluid rounded-3 border border-white border-opacity-25" style={{ maxHeight: '90px', objectFit: 'cover' }} />
                          </div>
                        )}
                        <div className={viewingMasteredItem.image_url ? "col-7 text-start" : "col-12"}>
                          {viewingMasteredItem.context && <p className="small fst-italic mb-0 opacity-90">{viewingMasteredItem.context}</p>}
                        </div>
                      </div>
                    )}
                  </div>

                  <span className="badge bg-white bg-opacity-25 rounded-pill px-3 py-2 small">
                    <i className="bi bi-arrow-clockwise me-1"></i> Cliquer pour retourner
                  </span>
                </div>
              </div>
              <div className="modal-footer border-0 bg-body-tertiary rounded-bottom-4 py-2">
                <button type="button" className="btn btn-secondary px-4 rounded-3" onClick={() => setViewingMasteredItem(null)}>Fermer</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
