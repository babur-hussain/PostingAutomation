import React, { useEffect, useState } from 'react';
import { 
  Share2, ArrowRight, Layers, BarChart3, Clock, 
  MessageCircle, Sparkles, Zap, Globe2, 
  Play, Apple, Smartphone, Settings, MapPin, Search, Users
} from 'lucide-react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import './App.css';

function App() {
  const [scrolled, setScrolled] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);

  const handleStoreClick = (e) => {
    e.preventDefault();
    setShowComingSoon(true);
  };

  useEffect(() => {
    // Lenis Smooth Scroll Setup
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), 
      direction: 'vertical',
      gestureDirection: 'vertical',
      smooth: true,
      mouseMultiplier: 1,
      smoothTouch: false,
      touchMultiplier: 2,
      infinite: false,
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="app-wrapper">
      <div className="bg-glow-blur bg-glow-top"></div>
      <div className="bg-glow-blur bg-glow-bottom"></div>

      {/* Navigation */}
      <nav className={`navbar ${scrolled ? 'nav-scrolled' : ''}`}>
        <div className="container nav-container">
          <div className="brand">
            <div className="brand-icon">
              <Share2 size={20} color="#fff" strokeWidth={3} />
            </div>
            <span>PostOnce</span>
          </div>
          
          <div className="nav-links">
            <a href="#features" className="nav-link">Features</a>
            <a href="#how-it-works" className="nav-link">How it Works</a>
            <a href="#analytics" className="nav-link">Analytics</a>
            <a href="#download" className="nav-link" style={{ color: 'var(--primary-light)' }}>Get the App</a>
          </div>

        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero container animate-fade-in">
        <div className="hero-pill">
          <Sparkles size={14} />
          <span>PostOnce Mobile App is now live</span>
        </div>
        
        <h1 className="hero-title">
          Your creative canvas <br />
          <span className="text-gradient-primary">in your pocket.</span>
        </h1>
        
        <p className="hero-subtitle">
          The ultimate social media management app for creators and agencies. Publish to Facebook, Instagram, Threads, X, and YouTube simultaneously from your phone.
        </p>
        
        <div className="hero-actions">
          <a href="#" onClick={handleStoreClick} className="btn btn-primary btn-lg" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
            Download the App
            <Smartphone size={20} />
          </a>
        </div>

        <div className="hero-image-wrapper">
          <img 
            src="/images/hero_dashboard.png" 
            alt="PostOnce Studio Dashboard" 
            className="hero-image" 
          />
        </div>
      </section>

      {/* Stats Section */}
      <section className="stats-section">
        <div className="container stats-grid">
          <div>
            <div className="stat-value text-gradient-primary">5+</div>
            <div className="stat-label">Supported Platforms</div>
          </div>
          <div>
            <div className="stat-value">10M+</div>
            <div className="stat-label">Posts Published</div>
          </div>
          <div>
            <div className="stat-value">99.9%</div>
            <div className="stat-label">Uptime Reliability</div>
          </div>
          <div>
            <div className="stat-value">24/7</div>
            <div className="stat-label">Growth Insights</div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="how-it-works container" style={{ padding: '120px 0' }}>
        <div className="section-header">
          <h2 className="section-title">Post everywhere in three steps</h2>
          <p className="section-subtitle">Simplified workflows designed to save you hours every week.</p>
        </div>
        
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number">01</div>
            <h3 className="step-title">Connect your accounts</h3>
            <p className="step-desc">Securely link your Facebook Pages, Instagram Business, X, Threads, and YouTube channels directly in the mobile app.</p>
          </div>
          <div className="step-card">
            <div className="step-number">02</div>
            <h3 className="step-title">Craft your post</h3>
            <p className="step-desc">Upload photos or video reels, write captivating captions, add location tags, and customize hashtags per platform.</p>
          </div>
          <div className="step-card">
            <div className="step-number">03</div>
            <h3 className="step-title">Publish or schedule</h3>
            <p className="step-desc">Hit publish to push universally, or pick a precise future date and time to let our automated scheduler do the heavy lifting.</p>
          </div>
        </div>
      </section>

      {/* Features Bento Grid */}
      <section id="features" className="features container" style={{ paddingBottom: '60px' }}>
        <div className="section-header">
          <h2 className="section-title">Everything you need to grow</h2>
          <p className="section-subtitle">A powerful suite of tools designed for modern creators.</p>
        </div>

        <div className="bento-grid">
          {/* Large Card 1 */}
          <div className="glass-panel bento-card bento-large">
            <div className="bento-icon">
              <Globe2 size={24} />
            </div>
            <h3 className="bento-title">Unified Digital Hub</h3>
            <p className="bento-desc">
              Connect all major platforms. Schedule and publish your images, videos, and reels to all audiences with a single click.
            </p>
            <div className="bento-image-container">
              <img src="/images/features_connected.png" alt="Connected Platforms" className="bento-image" style={{ objectFit: 'cover' }} />
            </div>
          </div>

          {/* Small Card 1 */}
          <div className="glass-panel bento-card">
            <div className="bento-icon" style={{ color: '#00cec9', background: 'rgba(0, 206, 201, 0.1)' }}>
              <Clock size={24} />
            </div>
            <h3 className="bento-title">Smart Scheduling</h3>
            <p className="bento-desc">
              Plan your content weeks in advance. PostOnce handles timezone conversions and background publishing automatically.
            </p>
          </div>

          {/* Small Card 2 */}
          <div className="glass-panel bento-card">
            <div className="bento-icon" style={{ color: '#fd79a8', background: 'rgba(253, 121, 168, 0.1)' }}>
              <MessageCircle size={24} />
            </div>
            <h3 className="bento-title">Social Listening</h3>
            <p className="bento-desc">
              Monitor your @mentions and replies instantly. Built-in interactive hub tailored specifically for engaging with your followers.
            </p>
          </div>

          {/* New Small Card 3 */}
          <div className="glass-panel bento-card">
            <div className="bento-icon" style={{ color: '#fed330', background: 'rgba(254, 211, 48, 0.1)' }}>
              <Search size={24} />
            </div>
            <h3 className="bento-title">Competitor Discovery</h3>
            <p className="bento-desc">
              Search by keywords or analyze competitor profiles directly from our Social Hub to gather inspiration and measure footprint.
            </p>
          </div>

          {/* New Small Card 4 */}
          <div className="glass-panel bento-card">
            <div className="bento-icon" style={{ color: '#a55eea', background: 'rgba(165, 94, 234, 0.1)' }}>
              <MapPin size={24} />
            </div>
            <h3 className="bento-title">Platform Specifics</h3>
            <p className="bento-desc">
              Tailor each post perfectly. Add custom location data, dedicated platform hashtags, and specific user mentions on the fly.
            </p>
          </div>

          {/* Large Card 2 */}
          <div className="glass-panel bento-card bento-large" id="analytics">
            <div className="bento-icon">
              <BarChart3 size={24} />
            </div>
            <h3 className="bento-title">Deep Analytics & Insights</h3>
            <p className="bento-desc">
              Track engagement, reach, and follower growth across all your connected portfolios. Make data-driven decisions to boost your digital presence.
            </p>
            <div className="bento-image-container">
              <img src="/images/analytics_insights.png" alt="Analytics Graph" className="bento-image" style={{ objectFit: 'cover', objectPosition: 'top' }} />
            </div>
          </div>
        </div>
      </section>

      {/* App Download / Promotional CTA */}
      <section id="download" className="app-promo-section container" style={{ padding: '120px 0' }}>
        <div className="promo-container glass-panel">
          <div className="promo-content">
            <div className="promo-badge">
              <Zap size={16} color="#000" />
              <span>Available Now</span>
            </div>
            <h2 className="promo-title">Manage your social empire on the go.</h2>
            <p className="promo-desc">
              Download the PostOnce mobile app to create, publish, and track your content from anywhere. Experience native performance, robust media upload support, and real-time push notifications.
            </p>
            
            <div className="store-buttons">
              <a href="#" onClick={handleStoreClick} className="store-btn apple-btn">
                <Apple size={28} />
                <div className="store-text">
                  <span className="store-sub">Download on the</span>
                  <span className="store-main">App Store</span>
                </div>
              </a>
              
              <a href="#" onClick={handleStoreClick} className="store-btn google-btn">
                <Play size={24} style={{ fill: 'currentColor' }} />
                <div className="store-text">
                  <span className="store-sub">GET IT ON</span>
                  <span className="store-main">Google Play</span>
                </div>
              </a>
            </div>
          </div>
          
          <div className="promo-visual">
            <div className="phone-mockup">
              <div className="phone-screen bg-glow-blur" style={{ opacity: 0.8, filter: 'blur(40px)', position: 'absolute' }}></div>
              <img src="/images/hero_dashboard.png" alt="Mobile App Screen" className="phone-screen-img" />
              <div className="phone-notch"></div>
            </div>
          </div>
        </div>
      </section>



      {/* Coming Soon Popup */}
      {showComingSoon && (
        <div className="popup-overlay" onClick={() => setShowComingSoon(false)}>
          <div className="popup-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="popup-icon"><Sparkles size={32} /></div>
            <h3>Coming Soon!</h3>
            <p style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>We're putting the final touches on our mobile app. Check back shortly to download PostOnce for iOS and Android.</p>
            <button className="btn btn-primary" onClick={() => setShowComingSoon(false)} style={{ width: '100%' }}>Got it</button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer container">
        <div className="footer-top">
          <div className="footer-brand">
            <div className="brand" style={{ marginBottom: '16px' }}>
              <div className="brand-icon">
                <Share2 size={20} color="#fff" strokeWidth={3} />
              </div>
              <span>PostOnce</span>
            </div>
            <p className="footer-desc">
              The modern mobile platform for content creators and businesses to publish, engage, and grow across the social web.
            </p>
          </div>
          
          <div className="footer-links">
            <div className="link-group">
              <h4>Product</h4>
              <ul>
                <li><a href="#features">Features</a></li>
                <li><a href="#how-it-works">How it Works</a></li>
                <li><a href="#analytics">Analytics</a></li>
                <li><a href="#download">Download App</a></li>
              </ul>
            </div>
            <div className="link-group">
              <h4>Resources</h4>
              <ul>
                <li><a href="#">Help Center</a></li>
                <li><a href="#">API Docs</a></li>
                <li><a href="#">Blog</a></li>
                <li><a href="#">Community</a></li>
              </ul>
            </div>
            <div className="link-group">
              <h4>Company</h4>
              <ul>
                <li><a href="#">About</a></li>
                <li><a href="#">Careers</a></li>
                <li><a href="#">Privacy Policy</a></li>
                <li><a href="#">Terms of Service</a></li>
              </ul>
            </div>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} PostOnce Inc. All rights reserved.</p>
          <div className="social-links" style={{ display: 'flex', gap: '16px' }}>
            <span style={{color: 'var(--text-secondary)'}}>Built for modern creators.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
