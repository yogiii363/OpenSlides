(function () {

'use strict';

// The core module for the OpenSlides projector
angular.module('OpenSlidesApp.core.projector', ['OpenSlidesApp.core'])

// Can be used to find out if the projector or the side is used
.constant('REALM', 'projector')

.run([
    '$http',
    'autoupdate',
    'DS',
    function ($http, autoupdate, DS) {
        autoupdate.newConnect();

        // If the connection aborts, we try to ping the server with whoami requests. If
        // the server is flushed, we clear the datastore, so the message 'this projector
        // cannot be shown' will be displayed. Otherwise establish the websocket connection.
        autoupdate.registerRetryConnectCallback(function () {
            return $http.get('/users/whoami').then(function (success) {
                if (success.data.user_id === null && !success.data.guest_enabled) {
                    DS.clear();
                } else {
                    autoupdate.newConnect();
                }
            });
        });
    }
])

// Provider to register slides in a .config() statement.
.provider('slides', [
    function() {
        var slidesMap = {};

        this.registerSlide = function(name, config) {
            slidesMap[name] = config;
            return this;
        };

        this.$get = function($templateRequest, $q) {
            var self = this;
            return {
                getElements: function(projector) {
                    var elements = [];
                    var factory = this;
                    _.forEach(projector.elements, function(element) {
                        if (element.name in slidesMap) {
                            element.template = slidesMap[element.name].template;
                            elements.push(element);
                        } else {
                            console.error("Unknown slide: " + element.name);
                        }
                    });
                    return elements;
                }
            };
        };
    }
])

.config([
    'slidesProvider',
    function(slidesProvider) {
        slidesProvider.registerSlide('core/clock', {
            template: 'static/templates/core/slide_clock.html',
        });

        slidesProvider.registerSlide('core/countdown', {
            template: 'static/templates/core/slide_countdown.html',
        });

        slidesProvider.registerSlide('core/projector-message', {
            template: 'static/templates/core/slide_message.html',
        });
    }
])

.controller('LanguageAndFontCtrl', [
    '$scope',
    'Languages',
    'Config',
    'Projector',
    'ProjectorID',
    'Fonts',
    function ($scope, Languages, Config, Projector, ProjectorID, Fonts) {
        // for the dynamic title
        $scope.projectorId = ProjectorID();
        $scope.$watch(function () {
            return Projector.lastModified($scope.projectorId);
        }, function () {
            var projector = Projector.get($scope.projectorId);
            if (projector) {
                $scope.projectorName = projector.name;
            }
        });

        $scope.$watch(function () {
            return Config.lastModified('projector_language');
        }, function () {
            var lang = Config.get('projector_language');
            if (!lang || lang.value == 'browser') {
                $scope.selectedLanguage = Languages.getBrowserLanguage();
            } else {
                $scope.selectedLanguage = lang.value;
            }
            Languages.setCurrentLanguage($scope.selectedLanguage);
        });

        $scope.$watch(function () {
            return Config.lastModified('font_regular') +
                Config.lastModified('font_italic') +
                Config.lastModified('font_bold') +
                Config.lastModified('font_bold_italic');
        }, function () {
            $scope.font = Fonts.getForCss('font_regular');
            $scope.font_medium = Fonts.getForCss('font_italic');
            $scope.font_condensed = Fonts.getForCss('font_bold');
            $scope.font_condensed_light = Fonts.getForCss('font_bold_italic');
        });
    }
])

// Projector Container Controller
.controller('ProjectorContainerCtrl', [
    '$scope',
    '$timeout',
    '$location',
    'gettext',
    'Projector',
    function($scope, $timeout, $location, gettext, Projector) {
        $scope.showError = true;

        // watch for changes in Projector
        $scope.$watch(function () {
            return Projector.lastModified($scope.projectorId);
        }, function () {
            var projector = Projector.get($scope.projectorId);
            if (projector) {
                $scope.showError = false;
                $scope.projectorWidth = projector.width;
                $scope.projectorHeight = projector.height;
                $scope.recalculateIframe();
            } else {
                $scope.showError = true;
                // delay displaying the error message, because with a slow internet
                // connection, the autoupdate with the projector may be delayed. We
                // de not want to irritate the user by showing this error to early.
                $scope.error = '';
                $timeout(function () {
                    if ($scope.showError) {
                        $scope.error = gettext('Can not open the projector.');
                    }
                }, 3000);
            }
        });

        // recalculate the actual Iframesize and scale
        $scope.recalculateIframe = function () {
            var scale_width = window.innerWidth / $scope.projectorWidth;
            var scale_height = window.innerHeight / $scope.projectorHeight;

            // Iframe has to be scaled down or saceUp is activated
            if (scale_width <= scale_height) {
                // width is the reference
                $scope.iframeWidth = window.innerWidth;
                $scope.scale = scale_width;
                $scope.iframeHeight = $scope.projectorHeight * scale_width;
            } else {
                // height is the reference
                $scope.iframeHeight = window.innerHeight;
                $scope.scale = scale_height;
                $scope.iframeWidth = $scope.projectorWidth * scale_height;
            }
        };

        // watch for changes in the windowsize
        $(window).on("resize.doResize", function () {
            $scope.$apply(function() {
                $scope.recalculateIframe();
            });
        });

        $scope.$on("$destroy",function (){
            $(window).off("resize.doResize");
        });
    }
])

.controller('ProjectorCtrl', [
    '$scope',
    '$location',
    '$timeout',
    'Projector',
    'slides',
    'Config',
    'ProjectorID',
    'Logos',
    function($scope, $location, $timeout, Projector, slides, Config, ProjectorID, Logos) {
        var projectorId = ProjectorID();

        $scope.broadcast = 0;

        var setElements = function (projector) {
            // Get all elements, that should be projected.
            var newElements = [];
            var enable_clock = Config.get('projector_enable_clock');
            enable_clock = enable_clock ? enable_clock.value : true;
            _.forEach(slides.getElements(projector), function (element) {
                if (!element.error) {
                    // Exclude the clock if it should be disabled.
                    if (enable_clock || element.name !== 'core/clock') {
                        newElements.push(element);
                    }
                } else {
                    console.error("Error for slide " + element.name + ": " + element.error);
                }
            });

            // Now we have to align $scope.elements to newElements:
            // We cannot just assign them, because the ng-repeat would reload every
            // element. This should be prevented (see #3259). To change $scope.elements:
            // 1) remove all elements from scope, that are not in newElements (compared by the uuid)
            // 2) Every new element in newElements, that is not in $scope.elements, get inserted there.
            // 3) If there is the same element in newElements and $scope.elements every changed property
            //    is copied from the new element to the scope element.

            $scope.elements = _.filter($scope.elements, function (element) {
                return _.some(newElements, function (newElement) {
                    return element.uuid === newElement.uuid;
                });
            });

            _.forEach(newElements, function (newElement) {
                var matchingElement = _.find($scope.elements, function (element) {
                    return element.uuid === newElement.uuid;
                });
                if (matchingElement) {
                    // copy all changed properties.
                    _.forEach(newElement, function (value, key) {
                        // key has own property and does not start with a '$'.
                        if (newElement.hasOwnProperty(key) && key.indexOf('$') != 0) {
                            if (typeof matchingElement[key] === 'undefined' || matchingElement[key] !== value) {
                                matchingElement[key] = value;
                            }
                        }
                    });
                } else {
                    $scope.elements.push(newElement);
                }
            });
        };

        $scope.scroll = 0;
        var setScroll = function (scroll) {
            $scope.scroll = -250 * scroll;
        };

        $scope.$watch(function () {
            return Projector.lastModified(projectorId);
        }, function () {
            $scope.projector = Projector.get(projectorId);
            if ($scope.projector) {
                if ($scope.broadcast === 0) {
                    setElements($scope.projector);
                    $scope.blank = $scope.projector.blank;
                }
                setScroll($scope.projector.scroll);
            } else {
                // Blank projector on error
                $scope.elements = [];
                $scope.projector = {
                    scale: 0,
                    blank: true
                };
                setScroll(0);
            }
        });

        $scope.$watch(function () {
            return Config.lastModified('projector_broadcast');
        }, function () {
            var bc = Config.get('projector_broadcast');
            if (bc) {
                if ($scope.broadcast != bc.value) {
                    $scope.broadcast = bc.value;
                    if ($scope.broadcastDeregister) {
                        // revert to original $scope.projector
                        $scope.broadcastDeregister();
                        $scope.broadcastDeregister = null;
                        setElements($scope.projector);
                        $scope.blank = $scope.projector.blank;
                    }
                }
                if ($scope.broadcast > 0) {
                    // get elements and blank from broadcast projector
                    $scope.broadcastDeregister = $scope.$watch(function () {
                        return Projector.lastModified($scope.broadcast);
                    }, function () {
                        if ($scope.broadcast > 0) {
                            var broadcast_projector = Projector.get($scope.broadcast);
                            if (broadcast_projector) {
                                setElements(broadcast_projector);
                                $scope.blank = broadcast_projector.blank;
                            }
                        }
                    });
                }
            }
        });

        $scope.$watch(function () {
            return Config.lastModified('projector_enable_clock');
        }, function () {
            setElements($scope.projector);
        });

        $scope.$on('$destroy', function() {
            if ($scope.broadcastDeregister) {
                $scope.broadcastDeregister();
                $scope.broadcastDeregister = null;
            }
        });
    }
])

.controller('SlideClockCtrl', [
    '$scope',
    '$interval',
    function($scope, $interval) {
        // Attention! Each object that is used here has to be dealt on server side.
        // Add it to the coresponding get_requirements method of the ProjectorElement
        // class.
        $scope.servertime = ( Date.now() / 1000 - $scope.serverOffset ) * 1000;
        var interval = $interval(function () {
            $scope.servertime = ( Date.now() / 1000 - $scope.serverOffset ) * 1000;
        }, 30000); // Update the clock every 30 seconds

        $scope.$on('$destroy', function() {
            if (interval) {
                $interval.cancel(interval);
            }
        });
    }
])

.controller('SlideCountdownCtrl', [
    '$scope',
    '$interval',
    'Countdown',
    function($scope, $interval, Countdown) {
        // Attention! Each object that is used here has to be dealt on server side.
        // Add it to the coresponding get_requirements method of the ProjectorElement
        // class.
        var id = $scope.element.id;
        var interval;
        var calculateCountdownTime = function (countdown) {
            countdown.seconds = Math.floor( $scope.countdown.countdown_time - Date.now() / 1000 + $scope.serverOffset );
        };
        $scope.$watch(function () {
            return Countdown.lastModified(id);
        }, function () {
            $scope.countdown = Countdown.get(id);
            if (interval) {
                $interval.cancel(interval);
            }
            if ($scope.countdown) {
                if ($scope.countdown.running) {
                    calculateCountdownTime($scope.countdown);
                    interval = $interval(function () { calculateCountdownTime($scope.countdown); }, 1000);
                } else {
                    $scope.countdown.seconds = $scope.countdown.countdown_time;
                }
            }
        });
        $scope.$on('$destroy', function() {
            // Cancel the interval if the controller is destroyed
            if (interval) {
                $interval.cancel(interval);
            }
        });
    }
])

.controller('SlideMessageCtrl', [
    '$scope',
    'ProjectorMessage',
    'Projector',
    'ProjectorID',
    'gettextCatalog',
    function($scope, ProjectorMessage, Projector, ProjectorID, gettextCatalog) {
        // Attention! Each object that is used here has to be dealt on server side.
        // Add it to the coresponding get_requirements method of the ProjectorElement
        // class.
        var id = $scope.element.id;

        if ($scope.element.identify) {
            var projector = Projector.get(ProjectorID());
            $scope.identifyMessage = gettextCatalog.getString('Projector') + ' ' + projector.id + ': ' + gettextCatalog.getString(projector.name);
        } else {
            $scope.message = ProjectorMessage.get(id);
            ProjectorMessage.bindOne(id, $scope, 'message');
        }
    }
]);

}());
