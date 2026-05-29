// tests/gateway.test.ts
// Regression tests for the upgraded multi-tier gateway detector.
import { detectGateways } from '../server/searchParsers';

describe('detectGateways — strong (CDN/SDK) signals', () => {
  test('Stripe via <script src=js.stripe.com>', () => {
    const r = detectGateways('<script src="https://js.stripe.com/v3/"></script>');
    expect(r.hasGateway).toBe(true);
    expect(r.gateways).toContain('stripe');
    // Both the body match and the script-src match should be recorded.
    expect(r.evidence.stripe).toEqual(expect.arrayContaining(['strong', 'script-src']));
  });

  test('Tap Payments via secure.gosell.io', () => {
    const r = detectGateways('<script src="https://secure.gosell.io/js/sdk/tap.min.js"></script>');
    expect(r.gateways).toContain('tap');
    expect(r.evidence.tap).toEqual(expect.arrayContaining(['strong', 'script-src']));
  });

  test('PayTabs via secure-global.paytabs.com', () => {
    const r = detectGateways('<form action="https://secure-global.paytabs.com/payment">');
    expect(r.gateways).toContain('paytabs');
  });

  test('HyperPay via oppwa.com (their checkout host)', () => {
    const r = detectGateways('<script src="https://eu-test.oppwa.com/v1/paymentWidgets.js"></script>');
    expect(r.gateways).toContain('hyperpay');
  });

  test('Adyen via checkoutshopper-live.adyen', () => {
    const r = detectGateways('<script src="https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/3.20.0/adyen.js"></script>');
    expect(r.gateways).toContain('adyen');
  });

  test('MyFatoorah portal SDK', () => {
    const r = detectGateways('integration with portal.myfatoorah.com is enabled');
    expect(r.gateways).toContain('myfatoorah');
  });
});

describe('detectGateways — weak signals require confirmation', () => {
  test('Bare "stripe" word with no payment context does not trigger', () => {
    const r = detectGateways('Our designer Stripe pattern is selling fast.');
    expect(r.hasGateway).toBe(false);
  });

  test('Weak signal + payment-context phrase ("Pay with") triggers', () => {
    const r = detectGateways('Pay with Tabby, Tamara, or Apple Pay');
    expect(r.hasGateway).toBe(true);
    expect(r.gateways).toEqual(expect.arrayContaining(['tabby', 'tamara']));
    expect(r.evidence.tabby).toContain('weak+context');
  });

  test('Weak signal + checkout URL triggers', () => {
    const html = `
      <p>Compatible with telr.</p>
      <a href="/checkout?step=2">Continue</a>
    `;
    const r = detectGateways(html);
    expect(r.gateways).toContain('telr');
    expect(r.evidence.telr).toContain('weak+checkout');
    expect(r.hasCheckoutUrl).toBe(true);
  });

  test('Returns empty for plain product copy with no payment cues', () => {
    const r = detectGateways('Just some product description with no payment mentions');
    expect(r.hasGateway).toBe(false);
    expect(r.hasCheckoutUrl).toBe(false);
  });
});

describe('detectGateways — checkout URL detection', () => {
  test('Marks hasCheckoutUrl on /cart/checkout', () => {
    const r = detectGateways('<a href="/cart/checkout">Place Order</a>');
    expect(r.hasCheckoutUrl).toBe(true);
  });

  test('Marks hasCheckoutUrl on /payment/success', () => {
    const r = detectGateways('redirected to /payment/success after submit');
    expect(r.hasCheckoutUrl).toBe(true);
  });
});
