/**
 * FakeXmlService.
 *
 * Wraps @xmldom/xmldom to expose Apps Script's XmlService API surface used
 * by src/Fx.js: parse(), getRootElement(), getChild(name, ns), getChildren(),
 * getAttribute(), namespace handling.
 *
 * Apps Script's XmlService treats namespaces as separate objects; xmldom uses
 * a string namespace URI on each Element. We bridge by storing the URI on
 * a Namespace wrapper and matching against `localName + namespaceURI` when
 * Apps Script-style queries come in.
 */

const { DOMParser } = require('@xmldom/xmldom');

class FakeNamespace {
  constructor(uri) { this.uri = uri; }
}

class FakeAttribute {
  constructor(value) { this._value = value; }
  getValue() { return this._value; }
}

class FakeElement {
  constructor(node) { this._node = node; }

  getChild(name, ns) {
    const targetUri = ns ? ns.uri : null;
    const children = this._node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.nodeType !== 1) continue; // skip non-element nodes
      if (c.localName !== name) continue;
      if (targetUri !== null && c.namespaceURI !== targetUri) continue;
      return new FakeElement(c);
    }
    return null;
  }

  getChildren(name, ns) {
    const targetUri = ns ? ns.uri : null;
    const out = [];
    const children = this._node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.nodeType !== 1) continue;
      if (name !== undefined && c.localName !== name) continue;
      if (targetUri !== null && c.namespaceURI !== targetUri) continue;
      out.push(new FakeElement(c));
    }
    return out;
  }

  getAttribute(name) {
    const attr = this._node.getAttribute(name);
    return attr === null || attr === '' ? null : new FakeAttribute(attr);
  }
}

class FakeDocument {
  constructor(domDoc) { this._doc = domDoc; }
  getRootElement() { return new FakeElement(this._doc.documentElement); }
}

function makeFakeXmlService() {
  return {
    parse(xml) {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      return new FakeDocument(doc);
    },
    getNamespace(uri) {
      return new FakeNamespace(uri);
    },
  };
}

module.exports = { makeFakeXmlService };
