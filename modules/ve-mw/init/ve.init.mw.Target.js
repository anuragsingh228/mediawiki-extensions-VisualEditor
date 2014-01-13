/*!
 * VisualEditor MediaWiki Initialization Target class.
 *
 * @copyright 2011-2014 VisualEditor Team and others; see AUTHORS.txt
 * @license The MIT License (MIT); see LICENSE.txt
 */

/*global mw */

/**
 * Initialization MediaWiki target.
 *
 * @class
 * @extends ve.init.Target
 *
 * @constructor
 * @param {jQuery} $container Conainter to render target into
 * @param {string} pageName Name of target page
 * @param {number} [revisionId] If the editor should load a revision of the page, pass the
 *  revision id here. Defaults to loading the latest version (see #load).
 */
ve.init.mw.Target = function VeInitMwTarget( $container, pageName, revisionId ) {
	var conf = mw.config.get( 'wgVisualEditorConfig' );

	// Parent constructor
	ve.init.Target.call( this, $container );

	// Properties
	this.pageName = pageName;
	this.pageExists = mw.config.get( 'wgArticleId', 0 ) !== 0;
	this.revid = revisionId || mw.config.get( 'wgCurRevisionId' );
	this.restoring = !!revisionId;
	this.editToken = mw.user.tokens.get( 'editToken' );
	this.apiUrl = mw.util.wikiScript( 'api' );
	this.submitUrl = ( new mw.Uri( mw.util.getUrl( this.pageName ) ) )
		.extend( { 'action': 'submit' } );

	this.modules = [
			'ext.visualEditor.mwcore',
			'ext.visualEditor.data'
		]
		.concat(
			document.createElementNS && document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' ).createSVGRect ?
				['ext.visualEditor.viewPageTarget.icons-vector', 'ext.visualEditor.icons-vector'] :
				['ext.visualEditor.viewPageTarget.icons-raster', 'ext.visualEditor.icons-raster']
		)
		.concat( conf.pluginModules || [] );

	this.pluginCallbacks = [];
	this.modulesReady = $.Deferred();
	this.preparedCacheKeyPromise = null;
	this.clearState();
	this.isMobileDevice = (
		'ontouchstart' in window ||
			( window.DocumentTouch && document instanceof window.DocumentTouch )
	);
};

/* Events */

/**
 * @event editConflict
 */

/**
 * @event save
 * @param {string} html Rendered page HTML from server
 * @param {string} categoriesHtml Rendered categories HTML from server
 * @param {number} [newid] New revision id, undefined if unchanged
 */

/**
 * @event showChanges
 * @param {string} diff
 */

/**
 * @event noChanges
 */

/**
 * @event saveAsyncBegin
 * Fired when we're waiting for network
 */

/**
 * @event saveAsyncComplete
 * Fired when we're no longer waiting for network
 */

/**
 * @event saveErrorEmpty
 * Fired when save API returns no data object
 */

/**
 * @event saveErrorSpamBlacklist
 * Fired when save is considered spam or blacklisted
 * @param {Object} editApi
 */

/**
 * @event saveErrorAbuseFilter
 * Fired when AbuseFilter throws warnings
 * @param {Object} editApi
 */

/**
 * @event saveErrorNewUser
 * Fired when user is logged in as a new user
 * @param {boolean|undefined} isAnon Is newly logged in user anonymous. If
 *  undefined, user is logged in
 */

/**
 * @event saveErrorCaptcha
 * Fired when saveError indicates captcha field is required
 * @param {Object} editApi
 */

/**
 * @event saveErrorUnknown
 * Fired for any other type of save error
 * @param {Object} editApi
 * @param {Object|null} data API response data
 */

/**
 * @event loadError
 * @param {jqXHR|null} jqXHR
 * @param {string} status Text status message
 * @param {Mixed|null} error HTTP status text
 */

/**
 * @event saveError
 * @param {jqXHR|null} jqXHR
 * @param {string} status Text status message
 * @param {Object|null} data API response data
 */

/**
 * @event showChangesError
 * @param {jqXHR|null} jqXHR
 * @param {string} status Text status message
 * @param {Mixed|null} error HTTP status text
 */

/**
 * @event serializeError
 * @param {jqXHR|null} jqXHR
 * @param {string} status Text status message
 * @param {Mixed|null} error HTTP status text
 */

/**
 * @event sanityCheckComplete
 */

/* Inheritance */

OO.inheritClass( ve.init.mw.Target, ve.init.Target );

/* Static Properties */

ve.init.mw.Target.static.toolbarGroups = [
	// History
	{ 'include': [ 'undo', 'redo' ] },
	// Format
	{
		'type': 'menu',
		'indicator': 'down',
		'include': [ { 'group': 'format' } ],
		'promote': [ 'paragraph' ],
		'demote': [ 'preformatted', 'heading1' ]
	},
	// Style
	{
		'type': 'list',
		'icon': 'text-style',
		'indicator': 'down',
		'include': [ { 'group': 'textStyle' }, 'clear' ],
		'promote': [ 'bold', 'italic' ],
		'demote': [ 'strikethrough', 'code',  'underline', 'clear' ]
	},
	// Link
	{ 'include': [ 'link' ] },
	// Structure
	{
		'type': 'bar',
		'include': [ 'number', 'bullet', 'outdent', 'indent' ]
	},
	// Insert
	{
		'label': 'visualeditor-toolbar-insert',
		'indicator': 'down',
		'include': '*',
		'demote': [ 'specialcharacter' ]
	}

];

/* Static Methods */

/**
 * Handle the RL modules for VE and registered plugin modules being loaded.
 *
 * This method is called within the context of a target instance. It executes all registered
 * plugin callbacks, gathers any promises returned and resolves this.modulesReady when all of
 * the gathered promises are resolved.
 */
ve.init.mw.Target.onModulesReady = function () {
	var i, len, callbackResult, promises = [];
	for ( i = 0, len = this.pluginCallbacks.length; i < len; i++ ) {
		callbackResult = this.pluginCallbacks[i]( this );
		if ( callbackResult && callbackResult.then ) { // duck-type jQuery.Promise using .then
			promises.push( callbackResult );
		}
	}
	// Dereference the callbacks
	this.pluginCallbacks = [];
	// Add the platform promise to the list
	promises.push( ve.init.platform.getInitializedPromise() );
	// Create a master promise tracking all the promises we got, and wait for it
	// to be resolved
	$.when.apply( $, promises ).done( this.modulesReady.resolve ).fail( this.modulesReady.reject );
};

/**
 * Handle response to a successful load request.
 *
 * This method is called within the context of a target instance. If successful the DOM from the
 * server will be parsed, stored in {this.doc} and then {this.onReady} will be called once modules
 * are ready.
 *
 * @static
 * @method
 * @param {Object} response XHR Response object
 * @param {string} status Text status message
 * @fires loadError
 */
ve.init.mw.Target.onLoad = function ( response ) {
	var data = response ? response.visualeditor : null;

	if ( !data && !response.error ) {
		ve.init.mw.Target.onLoadError.call(
			this, null, 'Invalid response in response from server', null
		);
	} else if ( response.error || data.result === 'error' ) {
		ve.init.mw.Target.onLoadError.call( this, null,
			response.error.code + ': ' + response.error.info,
			null
		);
	} else if ( typeof data.content !== 'string' ) {
		ve.init.mw.Target.onLoadError.call(
			this, null, 'No HTML content in response from server', null
		);
	} else {
		this.originalHtml = data.content;
		this.doc = ve.createDocumentFromHtml( this.originalHtml );

		this.remoteNotices = ve.getObjectValues( data.notices );
		this.$checkboxes = $( ve.getObjectValues( data.checkboxes ).join( '' ) );
		// Populate checkboxes with default values for minor and watch
		this.$checkboxes
			.filter( '#wpMinoredit' )
				.prop( 'checked', mw.user.options.get( 'minordefault' ) )
			.end()
			.filter( '#wpWatchthis' )
				.prop( 'checked',
					mw.user.options.get( 'watchdefault' ) ||
					( mw.user.options.get( 'watchcreations' ) && !this.pageExists ) ||
					mw.config.get( 'wgVisualEditor' ).isPageWatched
				);

		this.baseTimeStamp = data.basetimestamp;
		this.startTimeStamp = data.starttimestamp;
		this.revid = data.oldid;
		// Everything worked, the page was loaded, continue as soon as the modules are loaded
		this.modulesReady.done( ve.bind( this.onReady, this ) );
	}
};

/**
 * Handle the edit notices being ready for rendering.
 *
 * @method
 */
ve.init.mw.Target.prototype.onNoticesReady = function () {
	var i, len, noticeHtmls, tmp, el;

	// Since we're going to parse them, we might as well save these nodes
	// so we don't have to parse them again later.
	this.editNotices = {};

	/* Don't show notices without visible html (bug 43013). */

	// This is a temporary container for parsed notices in the <body>.
	// We need the elements to be in the DOM in order for stylesheets to apply
	// and jquery.visibleText to determine whether a node is visible.
	tmp = document.createElement( 'div' );

	// The following is essentially display none, but we can't use that
	// since then all descendants will be considered invisible too.
	tmp.style.cssText = 'position: static; top: 0; width: 0; height: 0; border: 0; visibility: hidden;';
	document.body.appendChild( tmp );

	// Merge locally and remotely generated notices
	noticeHtmls = this.remoteNotices.slice();
	for ( i = 0, len = this.localNoticeMessages.length; i < len; i++ ) {
		noticeHtmls.push(
			'<p>' + ve.init.platform.getParsedMessage( this.localNoticeMessages[i] ) + '</p>'
		);
	}

	for ( i = 0, len = noticeHtmls.length; i < len; i++ ) {
		el = $( '<div>' )
			.html( noticeHtmls[i] )
			.get( 0 );

		tmp.appendChild( el );
		if ( $.getVisibleText( el ).trim() !== '' ) {
			this.editNotices[i] = el;
		}
		tmp.removeChild( el );
	}
	document.body.removeChild( tmp );
};

/**
 * Handle both DOM and modules being loaded and ready.
 *
 * @method
 * @fires surfaceReady
 */
ve.init.mw.Target.prototype.onReady = function () {
	// We need to wait until onReady as local notices may require special messages
	this.onNoticesReady();
	this.loading = false;
	this.edited = false;
	this.setUpSurface( this.doc, ve.bind( function () {
		this.startSanityCheck();
		this.emit( 'surfaceReady' );
	}, this ) );
};

/**
 * Handle an unsuccessful load request.
 *
 * This method is called within the context of a target instance.
 *
 * @static
 * @method
 * @param {Object} jqXHR
 * @param {string} status Text status message
 * @param {Mixed} error HTTP status text
 * @fires loadError
 */
ve.init.mw.Target.onLoadError = function ( jqXHR, status, error ) {
	this.loading = false;
	this.emit( 'loadError', jqXHR, status, error );
};

/**
 * Handle a successful save request.
 *
 * This method is called within the context of a target instance.
 *
 * @static
 * @method
 * @param {Object} response Response data
 * @param {string} status Text status message
 * @fires editConflict
 * @fires save
 */
ve.init.mw.Target.onSave = function ( response ) {
	this.saving = false;
	var data = response.visualeditoredit;
	if ( !data && !response.error ) {
		this.onSaveError( null, 'Invalid response from server', response );
	} else if ( response.error ) {
		if ( response.error.code === 'editconflict' ) {
			this.emit( 'editConflict' );
		} else {
			this.onSaveError( null, 'Save failure', response );
		}
	} else if ( data.result !== 'success' ) {
		// Note, this could be any of db failure, hookabort, badtoken or even a captcha
		this.onSaveError( null, 'Save failure', response );
	} else if ( typeof data.content !== 'string' ) {
		this.onSaveError( null, 'Invalid HTML content in response from server', response );
	} else {
		this.emit( 'save', data.content, data.categorieshtml, data.newrevid );
	}
};

/**
 * Handle an unsuccessful save request.
 *
 * @method
 * @param {Object} jqXHR
 * @param {string} status Text status message
 * @param {Object|null} data API response data
 * @fires saveAsyncBegin
 * @fires saveAsyncComplete
 * @fires saveErrorEmpty
 * @fires saveErrorSpamBlacklist
 * @fires saveErrorAbuseFilter
 * @fires saveErrorNewUser
 * @fires saveErrorCaptcha
 * @fires saveErrorUnknown
 */
ve.init.mw.Target.prototype.onSaveError = function ( jqXHR, status, data ) {
	var api, editApi,
		trackData = {
			'duration': ve.now() - this.timings.saveDialogSave,
			'retries': this.timings.saveRetries
		},
		viewPage = this;
	this.saving = false;
	this.emit( 'saveAsyncComplete' );

	// Handle empty response
	if ( !data ) {
		trackData.type = 'empty';
		ve.track( 'performance.user.saveError', trackData );
		this.emit( 'saveErrorEmpty' );
		return;
	}
	editApi = data && data.visualeditoredit && data.visualeditoredit.edit;

	// Handle spam blacklist error (either from core or from Extension:SpamBlacklist)
	if ( editApi && editApi.spamblacklist ) {
		trackData.type = 'spamblacklist';
		ve.track( 'performance.user.saveError', trackData );
		this.emit( 'saveErrorSpamBlacklist', editApi );
		return;
	}

	// Handle warnings/errors from Extension:AbuseFilter
	// TODO: Move this to a plugin
	if ( editApi && editApi.info && editApi.info.indexOf( 'Hit AbuseFilter:' ) === 0 && editApi.warning ) {
		trackData.type = 'abusefilter';
		ve.track( 'performance.user.saveError', trackData );
		this.emit( 'saveErrorAbuseFilter', editApi );
		return;
	}

	// Handle token errors
	if ( data.error && data.error.code === 'badtoken' ) {
		api = new mw.Api();
		this.emit( 'saveAsyncBegin' );
		api.get( {
			// action=query&meta=userinfo and action=tokens&type=edit can't be combined
			// but action=query&meta=userinfo and action=query&prop=info can, however
			// that means we have to give it titles and deal with page ids.
			'action': 'query',
			'meta': 'userinfo',
			'prop': 'info',
			// Try to send the normalised form so that it is less likely we get extra data like
			// data.normalised back that we don't need.
			'titles': new mw.Title( viewPage.pageName ).toText(),
			'indexpageids': '',
			'intoken': 'edit'
		} )
			.always( function () {
				viewPage.emit( 'saveAsyncComplete' );
			} )
			.done( function ( data ) {
				var userMsg,
					userInfo = data.query && data.query.userinfo,
					pageInfo = data.query && data.query.pages && data.query.pageids &&
						data.query.pageids[0] && data.query.pages[ data.query.pageids[0] ],
					editToken = pageInfo && pageInfo.edittoken,
					isAnon = mw.user.isAnon();

				if ( userInfo && editToken ) {
					viewPage.editToken = editToken;

					if (
						( isAnon && userInfo.anon !== undefined ) ||
							// Comparing id instead of name to pretect against possible
							// normalisation and against case where the user got renamed.
							mw.config.get( 'wgUserId' ) === userInfo.id
					) {
						// New session is the same user still
						this.timings.saveRetries++;
						viewPage.saveDocument();
					} else {
						// The now current session is a different user
						trackData.type = 'badtoken';
						ve.track( 'performance.user.saveError', trackData );
						if ( isAnon ) {
							// New session is an anonymous user
							mw.config.set( {
								// wgUserId is unset for anonymous users, not set to null
								'wgUserId': undefined,
								// wgUserName is explicitly set to null for anonymous users,
								// functions like mw.user.isAnon rely on this.
								'wgUserName': null
							} );
						} else {
							// New session is a different user
							mw.config.set( { 'wgUserId': userInfo.id, 'wgUserName': userInfo.name } );
							userMsg = 'visualeditor-savedialog-identify-user---' + userInfo.name;
							mw.messages.set(
								userMsg,
								mw.messages.get( 'visualeditor-savedialog-identify-user' )
									.replace( /\$1/g, userInfo.name )
							);
						}
						viewPage.emit( 'saveErrorNewUser', isAnon );
					}

				}
			} );
		return;
	}

	// Handle captcha
	// Captcha "errors" usually aren't errors. We simply don't know about them ahead of time,
	// so we save once, then (if required) we get an error with a captcha back and try again after
	// the user solved the captcha.
	// TODO: ConfirmEdit API is horrible, there is no reliable way to know whether it is a "math",
	// "question" or "fancy" type of captcha. They all expose differently named properties in the
	// API for different things in the UI. At this point we only support the FancyCaptha which we
	// very intuitively detect by the presence of a "url" property.
	if ( editApi && editApi.captcha && editApi.captcha.url ) {
		trackData.type = 'captcha';
		ve.track( 'performance.user.saveError', trackData );
		this.emit( 'saveErrorCaptcha', editApi );
		return;
	}

	// Handle (other) unknown and/or unrecoverable errors
	trackData.type = 'unknown';
	ve.track( 'performance.user.saveError', trackData );
	this.emit( 'saveErrorUnknown', editApi, data );
};

/**
 * Handle a successful show changes request.
 *
 * @static
 * @method
 * @param {Object} response API response data
 * @param {string} status Text status message
 * @fires showChanges
 * @fires noChanges
 */
ve.init.mw.Target.onShowChanges = function ( response ) {
	var data = response.visualeditor;
	this.diffing = false;
	if ( !data && !response.error ) {
		ve.init.mw.Target.onShowChangesError.call( this, null, 'Invalid response from server', null );
	} else if ( response.error ) {
		ve.init.mw.Target.onShowChangesError.call(
			this, null, 'Unsuccessful request: ' + response.error.info, null
		);
	} else if ( data.result === 'nochanges' ) {
		this.emit( 'noChanges' );
	} else if ( data.result !== 'success' ) {
		ve.init.mw.Target.onShowChangesError.call( this, null, 'Failed request: ' + data.result, null );
	} else if ( typeof data.diff !== 'string' ) {
		ve.init.mw.Target.onShowChangesError.call(
			this, null, 'Invalid HTML content in response from server', null
		);
	} else {
		this.emit( 'showChanges', data.diff );
	}
};

/**
 * Handle errors during showChanges action.
 *
 * @static
 * @method
 * @this ve.init.mw.Target
 * @param {Object} jqXHR
 * @param {string} status Text status message
 * @param {Mixed} error HTTP status text
 * @fires showChangesError
 */
ve.init.mw.Target.onShowChangesError = function ( jqXHR, status, error ) {
	this.diffing = false;
	this.emit( 'showChangesError', jqXHR, status, error );
};

/**
 * Handle a successful serialize request.
 *
 * This method is called within the context of a target instance.
 *
 * @static
 * @method
 * @param {Object} data API response data
 * @param {string} status Text status message
 */
ve.init.mw.Target.onSerialize = function ( response ) {
	this.serializing = false;
	var data = response.visualeditor;
	if ( !data && !response.error ) {
		ve.init.mw.Target.onSerializeError.call( this, null, 'Invalid response from server', null );
	} else if ( response.error ) {
		ve.init.mw.Target.onSerializeError.call(
			this, null, 'Unsuccessful request: ' + response.error.info, null
		);
	} else if ( data.result === 'error' ) {
		ve.init.mw.Target.onSerializeError.call( this, null, 'Server error', null );
	} else if ( typeof data.content !== 'string' ) {
		ve.init.mw.Target.onSerializeError.call(
			this, null, 'No Wikitext content in response from server', null
		);
	} else {
		if ( typeof this.serializeCallback === 'function' ) {
			this.serializeCallback( data.content );
			delete this.serializeCallback;
		}
	}
};

/**
 * Handle an unsuccessful serialize request.
 *
 * This method is called within the context of a target instance.
 *
 * @static
 * @method
 * @param {jqXHR|null} jqXHR
 * @param {string} status Text status message
 * @param {Mixed|null} error HTTP status text
 * @fires serializeError
 */
ve.init.mw.Target.onSerializeError = function ( jqXHR, status, error ) {
	this.serializing = false;
	this.emit( 'serializeError', jqXHR, status, error );
};

/* Methods */

/**
 * Add a plugin module or callback.
 *
 * @param {string|Function} plugin Plugin module or callback
 */
ve.init.mw.Target.prototype.addPlugin = function ( plugin ) {
	if ( typeof plugin === 'string' ) {
		this.modules.push( plugin );
	} else if ( $.isFunction( plugin ) ) {
		this.pluginCallbacks.push( plugin );
	}
};

/**
 * Add an array of plugins.
 *
 * @see #addPlugin
 * @param {Array} plugins
 */
ve.init.mw.Target.prototype.addPlugins = function ( plugins ) {
	var i, len;
	for ( i = 0, len = plugins.length; i < len; i++ ) {
		this.addPlugin( plugins[i] );
	}
};

/**
 * Get HTML to send to Parsoid. This takes a document generated by the converter and
 * transplants the head tag from the old document into it, as well as the attributes on the
 * html and body tags.
 *
 * @param {HTMLDocument} newDoc Document generated by ve.dm.Converter. Will be modified.
 * @returns {string} Full HTML document
 */
ve.init.mw.Target.prototype.getHtml = function ( newDoc ) {
	var i, len, oldDoc = this.doc;

	function copyAttributes( from, to ) {
		var i, len;
		for ( i = 0, len = from.attributes.length; i < len; i++ ) {
			to.setAttribute( from.attributes[i].name, from.attributes[i].value );
		}
	}

	// Copy the head from the old document
	for ( i = 0, len = oldDoc.head.childNodes.length; i < len; i++ ) {
		newDoc.head.appendChild( oldDoc.head.childNodes[i].cloneNode( true ) );
	}
	// Copy attributes from the old document for the html, head and body
	copyAttributes( oldDoc.documentElement, newDoc.documentElement );
	copyAttributes( oldDoc.head, newDoc.head );
	copyAttributes( oldDoc.body, newDoc.body );
	return '<!doctype html>' + ve.properOuterHtml( newDoc.documentElement );
};

/**
 * Get DOM data from the Parsoid API.
 *
 * This method performs an asynchronous action and uses a callback function to handle the result.
 *
 * A side-effect of calling this method is that it requests {this.modules} be loaded.
 *
 * @method
 * @param {string[]} [additionalModules=[]] Resource loader modules
 * @returns {boolean} Loading has been started
*/
ve.init.mw.Target.prototype.load = function ( additionalModules ) {
	var data, start;
	// Prevent duplicate requests
	if ( this.loading ) {
		return false;
	}
	// Start loading the module immediately
	mw.loader.using(
		// Wait for site and user JS before running plugins
		this.modules.concat( additionalModules || [] ),
		ve.bind( ve.init.mw.Target.onModulesReady, this )
	);

	data = {
		'action': 'visualeditor',
		'paction': 'parse',
		'page': this.pageName,
		'format': 'json'
	};

	// Only request the API to explicitly load the currently visible revision if we're restoring
	// from oldid. Otherwise we should load the latest version. This prevents us from editing an
	// old version if an edit was made while the user was viewing the page and/or the user is
	// seeing (slightly) stale cache.
	if ( this.restoring ) {
		data.oldid = this.revid;
	}

	// Load DOM
	start = ve.now();

	this.loading = $.ajax( {
			'url': this.apiUrl,
			'data': data,
			'dataType': 'json',
			'type': 'POST',
			// Wait up to 100 seconds before giving up
			'timeout': 100000,
			'cache': 'false'
		} )
		.then( function ( data, status, jqxhr ) {
			ve.track( 'performance.system.domLoad', {
				'bytes': $.byteLength( jqxhr.responseText ),
				'duration': ve.now() - start,
				'cacheHit': /hit/i.test( jqxhr.getResponseHeader( 'X-Cache' ) ),
				'parsoid': jqxhr.getResponseHeader( 'X-Parsoid-Performance' )
			} );
			return jqxhr;
		} )
		.done( ve.bind( ve.init.mw.Target.onLoad, this ) )
		.fail( ve.bind( ve.init.mw.Target.onLoadError, this ) );

	return true;
};

/**
 * Clear the state of this target, preparing it to be reactivated later.
 */
ve.init.mw.Target.prototype.clearState = function () {
	this.clearPreparedCacheKey();
	this.loading = false;
	this.saving = false;
	this.diffing = false;
	this.serializing = false;
	this.submitting = false;
	this.baseTimeStamp = null;
	this.startTimeStamp = null;
	this.doc = null;
	this.originalHtml = null;
	this.editNotices = null;
	this.$checkboxes = null;
	this.remoteNotices = [];
	this.localNoticeMessages = [];
	this.sanityCheckFinished = false;
	this.sanityCheckVerified = false;
};

/**
 * Serialize the current document and store the result in the serialization cache on the server.
 *
 * This function returns a promise that is resolved once serialization is complete, with the
 * cache key passed as the first parameter.
 *
 * If there's already a request pending for the same (reference-identical) HTMLDocument, this
 * function will not initiate a new request but will return the promise for the pending request.
 * If a request for the same document has already been completed, this function will keep returning
 * the same promise (which will already have been resolved) until clearPreparedCacheKey() is called.
 *
 * @param {HTMLDocument} doc Document to serialize
 * @returns {jQuery.Promise} Abortable promise, resolved with the cache key.
 */
ve.init.mw.Target.prototype.prepareCacheKey = function ( doc ) {
	var xhr, html, start = ve.now(), deferred = $.Deferred();

	if ( this.preparedCacheKeyPromise && this.preparedCacheKeyPromise.doc === doc ) {
		return this.preparedCacheKeyPromise;
	}
	this.clearPreparedCacheKey();

	html = this.getHtml( doc );
	xhr = $.ajax( {
			'url': this.apiUrl,
			'data': {
				'action': 'visualeditor',
				'paction': 'serializeforcache',
				'html': html,
				'page': this.pageName,
				'oldid': this.revid,
				'format': 'json'
			},
			'dataType': 'json',
			'type': 'POST',
			// Wait up to 100 seconds before giving up
			'timeout': 100000,
			'cache': 'false'
		} )
		.done( function ( response ) {
			var trackData = { 'duration': ve.now() - start };
			if ( response.visualeditor && typeof response.visualeditor.cachekey === 'string' ) {
				ve.track( 'performance.system.serializeforcache', trackData );
				deferred.resolve( response.visualeditor.cachekey );
			} else {
				ve.track( 'performance.system.serializeforcache.nocachekey', trackData );
				deferred.reject();
			}
		} )
		.fail( function () {
			ve.track( 'performance.system.serializeforcache.fail', { 'duration': ve.now() - start } );
			deferred.reject();
		} );

	this.preparedCacheKeyPromise = deferred.promise( {
		'abort': xhr.abort,
		'html': html,
		'doc': doc
	} );
	return this.preparedCacheKeyPromise;
};

/**
 * Get the prepared wikitext, if any. Same as prepareWikitext() but does not initiate a request
 * if one isn't already pending or finished. Instead, it returns a rejected promise in that case.
 *
 * @param {HTMLDocument} doc Document to serialize
 * @returns {jQuery.Promise} Abortable promise, resolved with the cache key.
 */
ve.init.mw.Target.prototype.getPreparedCacheKey = function ( doc ) {
	var deferred;
	if ( this.preparedCacheKeyPromise && this.preparedCacheKeyPromise.doc === doc ) {
		return this.preparedCacheKeyPromise;
	}
	deferred = $.Deferred();
	deferred.reject();
	return deferred.promise();
};

/**
 * Clear the promise for the prepared wikitext cache key, and abort it if it's still in progress.
 */
ve.init.mw.Target.prototype.clearPreparedCacheKey = function () {
	if ( this.preparedCacheKeyPromise ) {
		this.preparedCacheKeyPromise.abort();
		this.preparedCacheKeyPromise = null;
	}
};

/**
 * Try submitting an API request with a cache key for prepared wikitext, falling back to submitting
 * HTML directly if there is no cache key present or pending, or if the request for the cache key
 * fails, or if using the cache key fails with a badcachekey error.
 *
 * @param {HTMLDocument} doc Document to submit
 * @param {Object} options POST parameters to send. Do not include 'html', 'cachekey' or 'format'.
 * @param {string} [eventName] If set, log an event when the request completes successfully. The
 *  full event name used will be 'performance.system.{eventName}.withCacheKey' or .withoutCacheKey
 *  depending on whether or not a cache key was used.
 * @returns {jQuery.Promise}
 */
ve.init.mw.Target.prototype.tryWithPreparedCacheKey = function ( doc, options, eventName ) {
	var data, preparedCacheKey = this.getPreparedCacheKey( doc ), target = this;
	data = $.extend( {}, options, { 'format': 'json' } );

	function ajaxRequest( cachekey ) {
		var start = ve.now();
		if ( typeof cachekey === 'string' ) {
			data.cachekey = cachekey;
		} else {
			// Getting a cache key failed, fall back to sending the HTML
			data.html = preparedCacheKey && preparedCacheKey.html || target.getHtml( doc );
			// If using the cache key fails, we'll come back here with cachekey still set
			delete data.cachekey;
		}
		return $.ajax( {
				'url': target.apiUrl,
				'data': data,
				'dataType': 'json',
				'type': 'POST',
				// Wait up to 100 seconds before giving up
				'timeout': 100000
			} )
			.then( function ( response, status, jqxhr ) {
				var fullEventName, eventData = {
					'bytes': $.byteLength( jqxhr.responseText ),
					'duration': ve.now() - start,
					'parsoid': jqxhr.getResponseHeader( 'X-Parsoid-Performance' )
				};
				if ( response.error && response.error.code === 'badcachekey' ) {
					// Log the failure if eventName was set
					if ( eventName ) {
						fullEventName = 'performance.system.' + eventName + '.badCacheKey';
						ve.track( fullEventName, eventData );
					}
					// This cache key is evidently bad, clear it
					target.clearPreparedCacheKey();
					// Try again without a cache key
					return ajaxRequest( null );
				}

				// Log data about the request if eventName was set
				if ( eventName ) {
					fullEventName = 'performance.system.' + eventName +
						( typeof cachekey === 'string' ? '.withCacheKey' : '.withoutCacheKey' );
					ve.track( fullEventName, eventData );
				}
				return jqxhr;
			} );
	}

	// If we successfully get prepared wikitext, then invoke ajaxRequest() with the cache key,
	// otherwise invoke it without.
	return preparedCacheKey.then( ajaxRequest, ajaxRequest );
};

/**
 * Post DOM data to the Parsoid API.
 *
 * This method performs an asynchronous action and uses a callback function to handle the result.
 *
 *     target.save( dom, { 'summary': 'test', 'minor': true, 'watch': false } );
 *
 * @method
 * @param {HTMLDocument} doc Document to save
 * @param {Object} options Saving options. All keys are passed through, including unrecognized ones.
 *  - {string} summary Edit summary
 *  - {boolean} minor Edit is a minor edit
 *  - {boolean} watch Watch the page
 * @returns {boolean} Saving has been started
*/
ve.init.mw.Target.prototype.save = function ( doc, options ) {
	var data;
	// Prevent duplicate requests
	if ( this.saving ) {
		return false;
	}

	data = $.extend( {}, options, {
		'action': 'visualeditoredit',
		'page': this.pageName,
		'oldid': this.revid,
		'basetimestamp': this.baseTimeStamp,
		'starttimestamp': this.startTimeStamp,
		'token': this.editToken
	} );

	this.saving = this.tryWithPreparedCacheKey( doc, data, 'save' )
		.done( ve.bind( ve.init.mw.Target.onSave, this ) )
		.fail( ve.bind( this.onSaveError, this ) );

	return true;
};

/**
 * Post DOM data to the Parsoid API to retrieve wikitext diff.
 *
 * @method
 * @param {HTMLDocument} doc Document to compare against (via wikitext)
 * @returns {boolean} Diffing has been started
*/
ve.init.mw.Target.prototype.showChanges = function ( doc ) {
	if ( this.diffing ) {
		return false;
	}
	this.diffing = this.tryWithPreparedCacheKey( doc, {
		'action': 'visualeditor',
		'paction': 'diff',
		'page': this.pageName,
		'oldid': this.revid
	}, 'diff' )
		.done( ve.bind( ve.init.mw.Target.onShowChanges, this ) )
		.fail( ve.bind( ve.init.mw.Target.onShowChangesError, this ) );

	return true;
};

/**
 * Post wikitext to MediaWiki.
 *
 * This method performs a synchronous action and will take the user to a new page when complete.
 *
 *     target.submit( wikitext, { 'wpSummary': 'test', 'wpMinorEdit': 1, 'wpSave': 1 } );
 *
 * @method
 * @param {string} wikitext Wikitext to submit
 * @param {Object} fields Other form fields to add (e.g. wpSummary, wpWatchthis, etc.). To actually
 *  save the wikitext, add { 'wpSave': 1 }. To go to the diff view, add { 'wpDiff': 1 }.
 * @returns {boolean} Submitting has been started
*/
ve.init.mw.Target.prototype.submit = function ( wikitext, fields ) {
	// Prevent duplicate requests
	if ( this.submitting ) {
		return false;
	}
	// Save DOM
	this.submitting = true;
	var key,
		$form = $( '<form method="post" enctype="multipart/form-data" style="display: none;"></form>' ),
		params = $.extend( {
			'format': 'text/x-wiki',
			'model': 'wikitext',
			'oldid': this.revid,
			'wpStarttime': this.baseTimeStamp,
			'wpEdittime': this.startTimeStamp,
			'wpTextbox1': wikitext,
			'wpEditToken': this.editToken
		}, fields );
	// Add params as hidden fields
	for ( key in params ) {
		$form.append( $( '<input>' ).attr( { 'type': 'hidden', 'name': key, 'value': params[key] } ) );
	}
	// Submit the form, mimicking a traditional edit
	// Firefox requires the form to be attached
	$form.attr( 'action', this.submitUrl ).appendTo( 'body' ).submit();
	return true;
};

/**
 * Get Wikitext data from the Parsoid API.
 *
 * This method performs an asynchronous action and uses a callback function to handle the result.
 *
 *     target.serialize(
 *         dom,
 *         function ( wikitext ) {
 *             // Do something with the loaded DOM
 *         }
 *     );
 *
 * @method
 * @param {HTMLDocument} doc Document to serialize
 * @param {Function} callback Function to call when complete, accepts error and wikitext arguments
 * @returns {boolean} Serializing has been started
*/
ve.init.mw.Target.prototype.serialize = function ( doc, callback ) {
	// Prevent duplicate requests
	if ( this.serializing ) {
		return false;
	}
	this.serializeCallback = callback;
	this.serializing = this.tryWithPreparedCacheKey( doc, {
		'action': 'visualeditor',
		'paction': 'serialize',
		'page': this.pageName,
		'oldid': this.revid
	}, 'serialize' )
		.done( ve.bind( ve.init.mw.Target.onSerialize, this ) )
		.fail( ve.bind( ve.init.mw.Target.onSerializeError, this ) );
	return true;
};

/**
 * Get list of edit notices.
 *
 * @returns {Object|null} List of edit notices or null if none are loaded
 */
ve.init.mw.Target.prototype.getEditNotices = function () {
	return this.editNotices;
};

// FIXME: split out view specific functionality, emit to subclass

/**
 * Switch to editing mode.
 *
 * @method
 * @param {HTMLDocument} doc HTML DOM to edit
 * @param {Function} [callback] Callback to call when done
 */
ve.init.mw.Target.prototype.setUpSurface = function ( doc, callback ) {
	var target = this;
	setTimeout( function () {
		// Build model
		var dmDoc = ve.dm.converter.getModelFromDom( doc );
		setTimeout( function () {
			// Create ui.Surface (also creates ce.Surface and dm.Surface and builds CE tree)
			target.surface = new ve.ui.Surface( dmDoc );
			target.surface.$element.addClass( 've-init-mw-viewPageTarget-surface' );
			setTimeout( function () {
				// Initialize surface
				target.surface.getContext().hide();
				target.$document = target.surface.$element.find( '.ve-ce-documentNode' );
				target.$element.append( target.surface.$element );
				target.setUpToolbar();

				target.$document.attr( {
					'lang': mw.config.get( 'wgVisualEditor' ).pageLanguageCode,
					'dir': mw.config.get( 'wgVisualEditor' ).pageLanguageDir
				} );
				// Add appropriately mw-content-ltr or mw-content-rtl class
				target.surface.view.$element.addClass(
					'mw-content-' + mw.config.get( 'wgVisualEditor' ).pageLanguageDir
				);
				target.active = true;
				// Now that the surface is attached to the document and ready,
				// let it initialize itself
				target.surface.initialize();
				setTimeout( callback );
			} );
		} );
	} );
};

/**
 * Show the toolbar.
 *
 * This also transplants the toolbar to a new location.
 *
 * @method
 */
ve.init.mw.Target.prototype.setUpToolbar = function () {
	this.toolbar = new ve.ui.TargetToolbar( this, this.surface, { 'shadow': true, 'actions': true } );
	this.toolbar.setup( this.constructor.static.toolbarGroups );
	this.surface.addCommands( this.constructor.static.surfaceCommands );
	if ( !this.isMobileDevice ) {
		this.toolbar.enableFloatable();
	}
	this.toolbar.$element
		.addClass( 've-init-mw-viewPageTarget-toolbar' )
		.insertBefore( $( '#firstHeading' ).length > 0 ? '#firstHeading' : this.surface.$element );
	this.toolbar.$bar.slideDown( 'fast', ve.bind( function () {
		// Check the surface wasn't torn down while the toolbar was animating
		if ( this.surface ) {
			this.toolbar.initialize();
			this.surface.emit( 'position' );
			this.surface.getContext().update();
		}
	}, this ) );
};

/**
 * Fire off the sanity check. Must be called before the surface is activated.
 *
 * To access the result, check whether #sanityCheckPromise has been resolved or rejected
 * (it's asynchronous, so it may still be pending when you check).
 *
 * @method
 * @fires sanityCheckComplete
 */
ve.init.mw.Target.prototype.startSanityCheck = function () {
	// We have to get a copy of the data now, before we unlock the surface and let the user edit,
	// but we can defer the actual conversion and comparison
	var viewPage = this,
		doc = viewPage.surface.getModel().getDocument(),
		data = new ve.dm.FlatLinearData( doc.getStore().clone(), ve.copy( doc.getFullData() ) ),
		oldDom = viewPage.doc,
		d = $.Deferred();

	// Reset
	viewPage.sanityCheckFinished = false;
	viewPage.sanityCheckVerified = false;

	setTimeout( function () {
		// We can't compare oldDom.body and newDom.body directly, because the attributes on the
		// <body> were ignored in the conversion. So compare each child separately.
		var i,
			len = oldDom.body.childNodes.length,
			newDoc = new ve.dm.Document( data, oldDom, undefined, doc.getInternalList(), doc.getInnerWhitespace() ),
			newDom = ve.dm.converter.getDomFromModel( newDoc );

		// Explicitly unlink our full copy of the original version of the document data
		data = undefined;

		if ( len !== newDom.body.childNodes.length ) {
			// Different number of children, so they're definitely different
			d.reject();
			return;
		}
		for ( i = 0; i < len; i++ ) {
			if ( !oldDom.body.childNodes[i].isEqualNode( newDom.body.childNodes[i] ) ) {
				d.reject();
				return;
			}
		}
		d.resolve();
	} );

	viewPage.sanityCheckPromise = d.promise()
		.done( function () {
			// If we detect no roundtrip errors,
			// don't emphasize "review changes" to the user.
			viewPage.sanityCheckVerified = true;
		})
		.always( function () {
			viewPage.sanityCheckFinished = true;
			viewPage.emit( 'sanityCheckComplete' );
		} );
};
