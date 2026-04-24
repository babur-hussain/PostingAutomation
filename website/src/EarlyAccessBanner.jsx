import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, CheckCircle, Download, Loader, X } from 'lucide-react';
import './EarlyAccessBanner.css';

// API endpoint targeting the NestJS backend with MongoDB
const APPS_SCRIPT_URL = 'http://localhost:3000/api/v1/early-access';

const COOKIE_KEY = 'postonce_early_access';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.postonce';

function getCookie() {
    try {
        const match = document.cookie.match(new RegExp('(^| )' + COOKIE_KEY + '=([^;]+)'));
        if (match) return JSON.parse(decodeURIComponent(match[2]));
    } catch (e) { /* ignore */ }
    return null;
}

function setCookie(data) {
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(JSON.stringify(data))};expires=${expires.toUTCString()};path=/`;
}

export default function EarlyAccessBanner() {
    const [cookieData, setCookieData] = useState(null);
    const [isApproved, setIsApproved] = useState(false);
    const [formData, setFormData] = useState({ name: '', email: '', mobile: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [dismissed, setDismissed] = useState(false);

    // Load cookie on mount
    useEffect(() => {
        const saved = getCookie();
        if (saved) {
            setCookieData(saved);
            if (saved.approved) {
                setIsApproved(true);
            }
        }
    }, []);

    // Poll for approval status when form is submitted
    useEffect(() => {
        if (!cookieData || isApproved || !cookieData.email) return;

        const checkApproval = async () => {
            try {
                const res = await fetch(`${APPS_SCRIPT_URL}/status?email=${encodeURIComponent(cookieData.email)}`);
                const data = await res.json();
                if (data.approved) {
                    setIsApproved(true);
                    setCookie({ ...cookieData, approved: true });
                }
            } catch (e) { /* silent fail */ }
        };

        checkApproval();
        const interval = setInterval(checkApproval, 60000); // Check every minute
        return () => clearInterval(interval);
    }, [cookieData, isApproved]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!formData.name.trim() || !formData.email.trim() || !formData.mobile.trim()) {
            setError('Please fill in all fields');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            setError('Please enter a valid email address');
            return;
        }

        if (!/^[0-9+\-\s()]{7,15}$/.test(formData.mobile.replace(/\s/g, ''))) {
            setError('Please enter a valid mobile number');
            return;
        }

        setIsSubmitting(true);
        try {
            await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name.trim(),
                    email: formData.email.trim(),
                    mobile: formData.mobile.trim()
                })
            });

            const data = {
                name: formData.name.trim(),
                email: formData.email.trim(),
                submitted: true,
                approved: false
            };
            setCookie(data);
            setCookieData(data);
        } catch (err) {
            setError('Something went wrong. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (dismissed) return null;

    // State: Approved → show download button
    if (cookieData?.submitted && isApproved) {
        return (
            <div className="ea-banner ea-banner-approved">
                <div className="ea-container">
                    <button className="ea-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">
                        <X size={18} />
                    </button>
                    <div className="ea-approved-content">
                        <div className="ea-approved-icon">
                            <CheckCircle size={28} />
                        </div>
                        <div className="ea-approved-text">
                            <h3>🎉 You're approved!</h3>
                            <p>Your early access with <strong>1 month free trial</strong> is ready. Download PostOnce now!</p>
                        </div>
                        <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className="ea-download-btn">
                            <Download size={18} />
                            <span>Download on Play Store</span>
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    // State: Submitted but not yet approved → show waiting message
    if (cookieData?.submitted) {
        return (
            <div className="ea-banner ea-banner-submitted">
                <div className="ea-container">
                    <button className="ea-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">
                        <X size={18} />
                    </button>
                    <div className="ea-submitted-content">
                        <div className="ea-submitted-icon">
                            <Sparkles size={24} />
                        </div>
                        <div className="ea-submitted-text">
                            <h3>You'll get early access to the app with a free trial for one month!</h3>
                            <p>Check back in an hour — we're reviewing your request. You'll see a download button here once you're approved.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // State: Not submitted → show form
    return (
        <div className="ea-banner ea-banner-form">
            <div className="ea-container">
                <div className="ea-form-wrapper">
                    <div className="ea-form-header">
                        <div className="ea-spark-icon">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3>Get Early Access</h3>
                            <p>Be the first to try PostOnce — includes <strong>1 month free trial!</strong></p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="ea-form">
                        <div className="ea-form-fields">
                            <input
                                type="text"
                                placeholder="Your Name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="ea-input"
                                id="ea-name"
                            />
                            <input
                                type="email"
                                placeholder="Email Address"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="ea-input"
                                id="ea-email"
                            />
                            <input
                                type="tel"
                                placeholder="Mobile Number"
                                value={formData.mobile}
                                onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                                className="ea-input"
                                id="ea-mobile"
                            />
                            <button type="submit" className="ea-submit-btn" disabled={isSubmitting} id="ea-submit">
                                {isSubmitting ? (
                                    <><Loader size={18} className="ea-spinner" /> Submitting...</>
                                ) : (
                                    <>Apply Now <ArrowRight size={18} /></>
                                )}
                            </button>
                        </div>
                        {error && <p className="ea-error">{error}</p>}
                    </form>
                </div>
            </div>
        </div>
    );
}
