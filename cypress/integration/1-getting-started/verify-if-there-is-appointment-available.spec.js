/// <reference types="cypress" />

// Welcome to Cypress!
//
// This spec file contains a variety of sample tests
// for a todo list app that are designed to demonstrate
// the power of writing tests in Cypress.
//
// To learn more about how Cypress works and
// what makes it such an awesome testing tool,
// please read our getting started guide:
// https://on.cypress.io/introduction-to-cypress
const getIframeDocument = () => {
  return cy
      .get('iframe')
      // Cypress yields jQuery element, which has the real
      // DOM element under property "0".
      // From the real DOM iframe element we can get
      // the "document" element, it is stored in "contentDocument" property
      // Cypress "its" command can access deep properties using dot notation
      // https://on.cypress.io/its
      .its('0.contentDocument').should('exist')
}

const getIframeBody = () => {
  // get the document
  return getIframeDocument()
      // automatically retries until body is loaded
      .its('body').should('not.be.undefined')
      // wraps "body" DOM element to allow
      // chaining more Cypress commands, like ".find(...)"
      .then(cy.wrap)
}

describe('example to-do app', () => {
  beforeEach(() => {
    // Cypress starts out with a blank slate for each test
    // so we must tell it to visit our website with the `cy.visit()` command.
    // Since we want to visit the same URL at the start of all our tests,
    // we include it in our beforeEach function so that it runs before each test
    const abholungLink = 'https://stadt.muenchen.de/terminvereinbarung_/terminvereinbarung_fs.html?&loc=FS&ct=10176296'
    const umschreibenLink= 'https://stadt.muenchen.de/terminvereinbarung_/terminvereinbarung_fs.html?&loc=FS&ct=1071898'
    cy.visit(umschreibenLink)
  })

  it('displays two todo items by default', () => {
    // We use the `cy.get()` command to get all elements that match the selector.
    // Then, we use `should` to assert that there are two matched items,
    // which are the two default items.

    getIframeBody().find('.WEB_APPOINT_FORWARDBUTTON').click()
    cy.wait(3000)
    const availableDates = getIframeBody().find('.nat_calendar_weekday_bookable')
    console.log(availableDates)
    availableDates.each(d=>{
      console.log(d)
    })
    // We can go even further and check that the default todos each contain
    // the correct text. We use the `first` and `last` functions
    // to get just the first and last matched elements individually,
    // and then perform an assertion with `should`.

  })
})
