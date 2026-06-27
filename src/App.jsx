import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialisation du client Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const LANGUAGES = [
  { id: 'en', name: 'Anglais', flag: '🇬🇧', gradient: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)' },
  { id: 'nl', name: 'Néerlandais', flag: '🇳🇱', gradient: 'linear-gradient(135deg, #c2410c 0%, #f97316 100%)' },
  { id: 'de', name: 'Allemand', flag: '🇩🇪', gradient: 'linear-gradient(135deg, #111827 0%, #374151 100%)' }
];

export default function App() {
  // --- ÉTAT DE LA LANGUE ---
  const [selectedLang, setSelectedLang] = useState(() => {
    return localStorage.getItem('fc_selected_lang') || null;
  });

  useEffect(() => {
    if (selectedLang) {
      localStorage.setItem('fc_selected_lang', selectedLang);
    } else {
      localStorage.removeItem('fc_selected_lang');
    }
  }, [selectedLang]);

  // --- ÉTATS DES DONNÉES ---
  const [cards, setCards] = useState([]);
  const [masteredWords, setMasteredWords] = useState([]);
  const [loading, setLoading] = useState(false);

  // Charger les données depuis Supabase dès que la langue change
  const fetchScoresAndCards = async () => {
    if (!selectedLang) return;
    setLoading(true);
    
    // Récupérer les cartes actives
    const { data: fetchedCards, error: err1 } = await supabase
      .from('cards')
      .select('*')
      .eq('lang', selectedLang)
      .order('id', { ascending: false });

    // Récupérer les mots maîtrisés
    const { data: fetchedMastered, error: err2 } = await supabase
      .from('mastered_words')
      .select('*')
      .eq('lang', selectedLang)
      .order('created_at', { ascending: false });

    if (!err1 && fetchedCards) setCards(fetchedCards);
    if (!err2 && fetchedMastered) setMasteredWords(fetchedMastered);
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
  const [triggerSuccessAnim, setTriggerSuccessAnim] = useState(false);

  // Formulaires
  const [wordInput, setWordInput] = useState('');
  const [translationInput, setTranslationInput] = useState('');
  const [typeInput, setTypeInput] = useState('n.');
  const [editingId, setEditingId] = useState(null);

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

  const activeCard = reviewableCards[currentCardIndex];
  const firstLetterHint = activeCard && activeCard.word ? activeCard.word.trim().charAt(0).toUpperCase() : '';

  // --- VÉRIFICATION DE LA RÉPONSE ---
  useEffect(() => {
    if (!activeCard) {
      setIsCorrect(false);
      return;
    }
    const cleanUser = userAnswer.trim().toLowerCase();
    const cleanTarget = activeCard.word.trim().toLowerCase();
    
    if (cleanUser === cleanTarget && cleanTarget.length > 0) {
      setIsCorrect(true);
      setTriggerSuccessAnim(true);
      const timer = setTimeout(() => setTriggerSuccessAnim(false), 600);
      return () => clearTimeout(timer);
    } else {
      setIsCorrect(false);
    }
  }, [userAnswer, activeCard]);

  const resetVerification = () => {
    setUserAnswer('');
    setIsCorrect(false);
    setIsFlipped(false);
  };

  // --- LOGIQUE DE RÉVISION ---
  const handleReviewScore = async (level) => {
    if (!activeCard) return;

    const targetDate = new Date();

    if (level === 'hard') {
      targetDate.setDate(targetDate.getDate() + 1);
      const nextReviewStr = targetDate.toISOString().split('T')[0];
      
      await supabase.from('cards').update({ next_review: nextReviewStr, easy_streak: 0 }).eq('id', activeCard.id);
      
    } else if (level === 'medium') {
      targetDate.setDate(targetDate.getDate() + 2);
      const nextReviewStr = targetDate.toISOString().split('T')[0];
      
      await supabase.from('cards').update({ next_review: nextReviewStr, easy_streak: 0 }).eq('id', activeCard.id);

    } else if (level === 'easy') {
      const newStreak = (activeCard.easy_streak || 0) + 1;
      if (newStreak >= 3) {
        // Transfert vers les mots maîtrisés
        await supabase.from('mastered_words').insert([{ word: activeCard.word, translation: activeCard.translation, type: activeCard.type, lang: selectedLang }]);
        // Suppression de la carte active
        await supabase.from('cards').delete().eq('id', activeCard.id);
      } else {
        targetDate.setDate(targetDate.getDate() + 3);
        const nextReviewStr = targetDate.toISOString().split('T')[0];
        await supabase.from('cards').update({ next_review: nextReviewStr, easy_streak: newStreak }).eq('id', activeCard.id);
      }
    }

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
        .update({ word: wordInput, translation: translationInput, type: typeInput })
        .eq('id', editingId);
      setEditingId(null);
    } else {
      await supabase
        .from('cards')
        .insert([{ word: wordInput, translation: translationInput, type: typeInput, lang: selectedLang }]);
      setCurrentPage(1);
    }
    setWordInput('');
    setTranslationInput('');
    setTypeInput('n.');
    await fetchScoresAndCards();
  };

  const handleEdit = (card) => {
    setEditingId(card.id);
    setWordInput(card.word);
    setTranslationInput(card.translation);
    setTypeInput(card.type || 'n.');
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

  const handleDeleteMastered = async (e, id) => {
    e.stopPropagation();
    await supabase.from('mastered_words').delete().eq('id', id);
    if (viewingMasteredItem && viewingMasteredItem.id === id) {
      setViewingMasteredItem(null);
    }
    await fetchScoresAndCards();
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
      <div className="container py-5 min-h-screen d-flex flex-column justify-content-center align-items-center bg-light">
        <div className="text-center mb-5">
          <h1 className="display-5 fw-extrabold text-dark mb-2">Vocabulaire & Flashcards</h1>
          <p className="text-muted fs-5">Choisissez la langue que vous souhaitez réviser ou enrichir aujourd'hui</p>
        </div>
        <div className="row g-4 w-100 max-w-md justify-content-center">
          {LANGUAGES.map((lang) => (
            <div key={lang.id} className="col-12">
              <button
                onClick={() => {
                  setSelectedLang(lang.id);
                  setCurrentCardIndex(0);
                  resetVerification();
                }}
                className="btn w-100 p-4 rounded-4 shadow-sm text-white text-start d-flex align-items-center justify-content-between border-0 transition-transform"
                style={{ background: lang.gradient, transform: 'scale(1)', transition: 'transform 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div className="d-flex align-items-center gap-3">
                  <span className="display-6">{lang.flag}</span>
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
    <div className="container py-4">
      <style>{`
        @keyframes pulse-success {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(25, 135, 84, 0.7); }
          50% { transform: scale(1.03); box-shadow: 0 0 0 15px rgba(25, 135, 84, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(25, 135, 84, 0); }
        }
        .anim-success { animation: pulse-success 0.6s ease-out; }
      `}</style>

      {/* Navigation supérieure */}
      <div className="d-flex justify-content-between align-items-center mb-4 bg-white p-3 rounded-4 shadow-sm">
        <div className="d-flex align-items-center gap-3">
          <span className="fs-2">{currentLangConfig?.flag}</span>
          <h1 className="h4 mb-0 fw-bold text-dark">Espace d'apprentissage : {currentLangConfig?.name}</h1>
        </div>
        <button onClick={() => setSelectedLang(null)} className="btn btn-outline-secondary rounded-3 d-flex align-items-center gap-2">
          <i className="bi bi-arrow-left"></i> Changer de langue
        </button>
      </div>

      {loading && (
        <div className="text-center my-3 text-secondary">
          <div className="spinner-border spinner-border-sm me-2" role="status"></div>
          Synchronisation avec la base de données...
        </div>
      )}

      <div className="row g-4">
        
        {/* COLONNE GAUCHE & CENTRE */}
        <div className="col-12 col-lg-8">
          
          {/* Flashcard active */}
          <div className="card shadow-sm border-0 rounded-4 mb-4">
            <div className="card-body p-4">
              <h2 className="h5 card-title mb-4 text-secondary d-flex align-items-center justify-content-between">
                <span><i className="bi bi-book text-primary me-2"></i>Révision active</span>
                <span className="badge bg-secondary rounded-pill fs-6 fw-normal">À réviser : {reviewableCards.length}</span>
              </h2>

              {reviewableCards.length > 0 ? (
                <div>
                  <div 
                    onClick={() => isCorrect && setIsFlipped(!isFlipped)}
                    className={`p-5 rounded-4 text-center text-white mb-4 d-flex flex-column justify-content-between align-items-center shadow-sm ${triggerSuccessAnim ? 'anim-success' : ''}`}
                    style={{ 
                      background: isCorrect 
                        ? 'linear-gradient(135deg, #198754 0%, #157347 100%)' 
                        : currentLangConfig?.gradient,
                      minHeight: '260px',
                      cursor: isCorrect ? 'pointer' : 'default',
                      transition: 'background 0.4s ease'
                    }}
                  >
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-uppercase tracking-wider small opacity-75 fw-bold">
                        {isFlipped ? `Mot ${currentLangConfig?.name}` : 'Mot Français'}
                      </span>
                      <span className="badge bg-white bg-opacity-25 text-white rounded-pill font-monospace">
                        {activeCard.type || 'n.'}
                      </span>
                      {activeCard.easy_streak > 0 && (
                        <span className="badge bg-warning text-dark rounded-pill small">
                          <i className="bi bi-star-fill me-1"></i>Série : {activeCard.easy_streak}/3
                        </span>
                      )}
                    </div>
                    
                    <p className="display-6 fw-bold my-3">
                      {isFlipped ? activeCard.word : activeCard.translation}
                    </p>

                    {isCorrect ? (
                      <span className="badge bg-white text-success rounded-pill px-3 py-2 btn btn-sm border-0 shadow-sm fw-bold">
                        <i className="bi bi-arrow-clockwise me-1"></i> Cliquer pour retourner
                      </span>
                    ) : (
                      <span className="badge bg-white bg-opacity-10 text-white rounded-pill px-3 py-2 small border-0 opacity-75">
                        <i className="bi bi-lock-fill me-1"></i> Saisissez la traduction correcte
                      </span>
                    )}
                  </div>

                  {/* Champ de vérification */}
                  <div className="mb-4">
                    <div className="input-group input-group-lg shadow-sm rounded-3 overflow-hidden">
                      <span className={`input-group-text border-0 text-white transition-colors ${isCorrect ? 'bg-success' : 'bg-secondary bg-opacity-25 text-dark'}`}>
                        {isCorrect ? <i className="bi bi-check-lg"></i> : <i className="bi bi-pencil-square"></i>}
                      </span>
                      <input 
                        type="text"
                        placeholder={isCorrect ? "Trouvé !" : `Commence par : "${firstLetterHint}"...`}
                        value={userAnswer}
                        onChange={(e) => setUserAnswer(e.target.value)}
                        className={`form-control border-0 bg-light ${isCorrect ? 'fw-bold text-success' : ''}`}
                        disabled={isCorrect && isFlipped}
                      />
                    </div>
                  </div>

                  {/* Choix de planification */}
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <div className="d-flex gap-2 flex-grow-1">
                      <button onClick={() => handleReviewScore('hard')} className="btn btn-danger flex-grow-1 py-2.5 rounded-3 fw-medium shadow-sm" disabled={!isCorrect}>
                        Difficile <span className="d-block small opacity-75 fw-normal">(Demain)</span>
                      </button>
                      <button onClick={() => handleReviewScore('medium')} className="btn btn-warning text-dark flex-grow-1 py-2.5 rounded-3 fw-medium shadow-sm" disabled={!isCorrect}>
                        Moyen <span className="d-block small opacity-75 fw-normal">(2 jours)</span>
                      </button>
                      <button onClick={() => handleReviewScore('easy')} className="btn btn-success flex-grow-1 py-2.5 rounded-3 fw-medium shadow-sm" disabled={!isCorrect}>
                        Facile <span className="d-block small opacity-75 fw-normal">(3 j. consécutifs)</span>
                      </button>
                    </div>
                    {reviewableCards.length > 1 && (
                      <button onClick={nextCard} className="btn btn-outline-secondary px-4 py-3 rounded-3">Passer</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-5 text-center border rounded-4 border-dashed bg-light text-muted">
                  <p className="fw-medium mb-1"><i className="bi bi-calendar-check text-success h4 d-block mb-2"></i>Tout est à jour pour cette langue !</p>
                  <p className="small mb-0">Revenez demain ou ajoutez de nouveaux termes ci-dessous.</p>
                </div>
              )}
            </div>
          </div>

          {/* Formulaire et Gestion */}
          <div className="card shadow-sm border-0 rounded-4">
            <div className="card-body p-4">
              <h3 className="h5 card-title mb-4 text-secondary">{editingId ? 'Modifier le mot' : 'Ajouter un nouveau mot'}</h3>
              
              <form onSubmit={handleAddOrUpdate} className="row g-3 mb-4">
                <div className="col-md-5">
                  <input type="text" placeholder={`Mot en ${currentLangConfig?.name}`} value={wordInput} onChange={(e) => setWordInput(e.target.value)} className="form-control py-2.5 bg-light border-0 rounded-3" />
                </div>
                <div className="col-md-5">
                  <input type="text" placeholder="Traduction française" value={translationInput} onChange={(e) => setTranslationInput(e.target.value)} className="form-control py-2.5 bg-light border-0 rounded-3" />
                </div>
                <div className="col-md-2">
                  <select value={typeInput} onChange={(e) => setTypeInput(e.target.value)} className="form-select py-2.5 bg-light border-0 rounded-3 text-secondary fw-medium">
                    <option value="n.">Nom (n.)</option>
                    <option value="v.">Verbe (v.)</option>
                    <option value="adj.">Adjectif (adj.)</option>
                    <option value="adv.">Adverbe (adv.)</option>
                    <option value="exp.">Expression (exp.)</option>
                  </select>
                </div>
                <div className="col-12 d-flex justify-content-end">
                  <button type="submit" className="btn btn-primary px-5 py-2.5 rounded-3 shadow-sm">
                    {editingId ? 'Mettre à jour le mot' : 'Ajouter aux révisions'}
                  </button>
                </div>
              </form>

              {/* Table de Gestion */}
              <div className="table-responsive border rounded-3 mb-3">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light text-uppercase small text-muted">
                    <tr>
                      <th className="px-4 py-3">Mot ({currentLangConfig?.name})</th>
                      <th className="px-4 py-3">Nature</th>
                      <th className="px-4 py-3">Traduction (Fr)</th>
                      <th className="px-4 py-3 text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentCards.map((card) => (
                      <tr key={card.id}>
                        <td className="px-4 py-3 fw-medium text-dark">{card.word}</td>
                        <td className="px-4 py-3 font-monospace">
                          <span className="badge bg-light text-secondary border">{card.type || 'n.'}</span>
                        </td>
                        <td className="px-4 py-3 text-secondary">{card.translation}</td>
                        <td className="px-4 py-3 text-end">
                          <button onClick={() => handleEdit(card)} className="btn btn-sm btn-light text-primary me-2 rounded-2"><i className="bi bi-pencil"></i></button>
                          <button onClick={() => handleDelete(card.id)} className="btn btn-sm btn-light text-danger rounded-2"><i className="bi bi-trash"></i></button>
                        </td>
                      </tr>
                    ))}
                    {cards.length === 0 && (
                      <tr>
                        <td colSpan="4" className="text-center py-4 text-muted small">Aucun mot enregistré dans cette langue.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <nav className="d-flex justify-content-between align-items-center px-1">
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

        </div>

        {/* COLONNE DROITE : Mots maîtrisés */}
        <div className="col-12 col-lg-4">
          <div className="card shadow-sm border-0 rounded-4 sticky-top" style={{ top: '2rem' }}>
            <div className="card-body p-4">
              <h2 className="h5 card-title mb-4 text-secondary d-flex align-items-center gap-2">
                <i className="bi bi-check-circle-fill text-success"></i> Maîtrisés ({masteredWords.length})
              </h2>
              
              <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 12rem)' }}>
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
                      <div className="d-flex flex-column">
                        <span className="fw-medium text-success">{item.word}</span>
                        <span className="small text-success opacity-75 font-monospace">{item.type || 'n.'}</span>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge bg-success rounded-pill px-2.5 py-1.5 small fw-semibold">Voir</span>
                        <button onClick={(e) => handleDeleteMastered(e, item.id)} className="btn btn-sm btn-link text-danger p-0 border-0 lh-1">
                          <i className="bi bi-x-circle-fill h5 mb-0"></i>
                        </button>
                      </div>
                    </li>
                  ))}
                  {masteredWords.length === 0 && (
                    <p className="text-center text-muted small py-4">Aucun mot maîtrisé pour l'instant.</p>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* MODALE DE CONSULTATION */}
      {viewingMasteredItem && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setViewingMasteredItem(null)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content border-0 rounded-4 shadow-lg">
              <div className="modal-header border-0 bg-light rounded-top-4 py-3">
                <h5 className="modal-title fw-bold text-dark d-flex align-items-center gap-2">
                  <i className="bi bi-eye text-success"></i> Consultation Mot Acquis
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
                    minHeight: '240px',
                    cursor: 'pointer'
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-uppercase tracking-wider small opacity-75 fw-bold">
                      {isMasteredFlipped ? 'Traduction Française' : `Mot ${currentLangConfig?.name}`}
                    </span>
                    <span className="badge bg-white bg-opacity-25 text-white rounded-pill font-monospace">
                      {viewingMasteredItem.type || 'n.'}
                    </span>
                  </div>

                  <p className="display-6 fw-bold my-3">
                    {isMasteredFlipped ? viewingMasteredItem.translation : viewingMasteredItem.word}
                  </p>

                  <span className="badge bg-white bg-opacity-25 rounded-pill px-3 py-2 small">
                    <i className="bi bi-arrow-clockwise me-1"></i> Cliquer pour retourner
                  </span>
                </div>
              </div>
              <div className="modal-footer border-0 bg-light rounded-bottom-4 py-2">
                <button type="button" className="btn btn-secondary px-4 rounded-3" onClick={() => setViewingMasteredItem(null)}>Fermer</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}