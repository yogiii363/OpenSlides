angular.module('OpenSlidesApp.agenda', [])

.factory('Agenda', function(DS, jsDataModel) {
    var name = 'agenda/item'
    return DS.defineResource({
        name: name,
        endpoint: '/rest/agenda/item/',
        useClass: jsDataModel,
        methods: {
            getResourceName: function () {
                return name;
            }
        }
    });
})

// Make sure that the Agenda resource is loaded.
.run(function(Agenda) {});


angular.module('OpenSlidesApp.agenda.site', ['OpenSlidesApp.agenda'])

.config(function($stateProvider) {
    $stateProvider
        .state('agenda', {
            url: '/agenda',
            abstract: true,
            template: "<ui-view/>",
        })
        .state('agenda.item', {
            abstract: true,
            template: "<ui-view/>",
        })
        .state('agenda.item.list', {
            resolve: {
                items: function(Agenda) {
                    return Agenda.findAll();
                },
                tree: function($http) {
                    return $http.get('/rest/agenda/item/tree/');
                }
            }
        })
        .state('agenda.item.create', {
            resolve: {
                types: function($http) {
                    // get all item types
                    return $http({ 'method': 'OPTIONS', 'url': '/rest/agenda/item/' });
                }
            }
        })
        .state('agenda.item.detail', {
            resolve: {
                item: function(Agenda, $stateParams) {
                    return Agenda.find($stateParams.id);
                },
                users: function(User) {
                    return User.findAll();
                }
            }
        })
        .state('agenda.item.detail.update', {
            views: {
                '@agenda.item': {}
            },
            resolve: {
                types: function($http) {
                    // get all item types
                    return $http({ 'method': 'OPTIONS', 'url': '/rest/agenda/item/' });
                }
            }
        })
        .state('agenda.item.sort', {
            resolve: {
                items: function(Agenda) {
                    return Agenda.findAll();
                },
                tree: function($http) {
                    return $http.get('/rest/agenda/item/tree/');
                }
            },
            url: '/sort',
            controller: 'AgendaSortCtrl',
        })
        .state('agenda.item.import', {
            url: '/import',
            controller: 'AgendaImportCtrl',
        });
})

.controller('ItemListCtrl', function($scope, $http, Agenda, tree, Projector) {
    Agenda.bindAll({}, $scope, 'items');

    // get a 'flat' (ordered) array of agenda tree to display in table
    $scope.flattenedTree = buildTree(tree.data);
    function buildTree(tree, level) {
        var level = level || 0
        var nodes = [];
        var defaultlevel = level;
        _.each(tree, function(node) {
            level = defaultlevel;
            if (node.id) {
                nodes.push({ id: node.id, level: level });
            }
            if (node.children) {
                level++;
                var child = buildTree(node.children, level);
                if (child.length) {
                    nodes = nodes.concat(child);
                }
            }
        });
        return nodes;
    }

    // save changed item
    $scope.save = function (item) {
        Agenda.save(item);
    };
    // delete selected item
    $scope.delete = function (id) {
        Agenda.destroy(id);
    };
    // project agenda
    $scope.projectAgenda = function () {
        $http.post('/rest/core/projector/1/prune_elements/',
                [{name: 'agenda/item-list'}]);
    };
    // check if agenda is projected
    $scope.isAgendaProjected = function () {
        // Returns true if there is a projector element with the same
        // name and agenda is active.
        var projector = Projector.get(id=1);
        if (typeof projector === 'undefined') return false;
        var self = this;
        return _.findIndex(projector.elements, function(element) {
            return element.name == 'agenda/item-list'
        }) > -1;

    };
})

.controller('ItemDetailCtrl', function($scope, $http, Agenda, User, item) {
    Agenda.bindOne(item.id, $scope, 'item');
    User.bindAll({}, $scope, 'users');
    $scope.speaker = {};
    $scope.alert = {};

    // close/open list of speakers of current item
    $scope.closeList = function (listClosed) {
        item.speakerListClosed = listClosed;
        Agenda.save(item);
    };
    // add user to list of speakers
    $scope.addSpeaker = function (userId) {
        $http.post('/rest/agenda/item/' + item.id + '/manage_speaker/', {'user': userId})
            .success(function(data){
                $scope.alert.show = false;
            })
            .error(function(data){
                $scope.alert = { type: 'danger', msg: data.detail, show: true };
            });
    };
    // delete speaker(!) from list of speakers
    $scope.removeSpeaker = function (speakerId) {
        $http.delete('/rest/agenda/item/' + item.id + '/manage_speaker/',
                {headers: {'Content-Type': 'application/json'},
                 data: JSON.stringify({speaker: speakerId})});
    };
})

.controller('ItemCreateCtrl', function($scope, $state, Agenda, types) {
    $scope.types = types.data.actions.POST.type.choices;  // get all item types
    $scope.save = function (item) {
        if (!item)
            return null;
        item.weight = 0;  // TODO: the rest_api should do this
        item.tags = [];   // TODO: the rest_api should do this
        Agenda.create(item).then(
            function(success) {
                $state.go('agenda.item.list');
            }
        );
    };
})

.controller('ItemUpdateCtrl', function($scope, $state, Agenda, types, item) {
    $scope.types = types.data.actions.POST.type.choices;  // get all item types
    $scope.item = item;
    $scope.save = function (item) {
        Agenda.save(item).then(
            function(success) {
                $state.go('agenda.item.list');
            }
        );
    };
})

.controller('AgendaSortCtrl', function($scope, $http, Agenda, tree) {
    Agenda.bindAll({}, $scope, 'items');
    $scope.tree = tree.data;

    // set changed agenda tree
    $scope.treeOptions = {
        dropped: function(e) {
            $http.put('/rest/agenda/item/tree/', {tree: $scope.tree});
        }
      };
})

.controller('AgendaImportCtrl', function($scope, $state, Agenda) {
    // import from textarea
    $scope.importByLine = function () {
        $scope.items = $scope.itemlist[0].split("\n");
        $scope.importcounter = 0;
        $scope.items.forEach(function(title) {
            var item = {title: title};
            item.weight = 0;  // TODO: the rest_api should do this
            item.tags = [];   // TODO: the rest_api should do this
            // TODO: create all items in bulk mode
            Agenda.create(item).then(
                function(success) {
                    $scope.importcounter++;
                }
            );
        });
    }

    // import from csv file
    $scope.csv = {
        content: null,
        header: true,
        separator: ',',
        result: null
    };
    $scope.importByCSV = function (result) {
        var obj = JSON.parse(JSON.stringify(result));
        $scope.csvimporting = true;
        $scope.csvlines = Object.keys(obj).length;
        $scope.csvimportcounter = 0;
        for (var i = 0; i < obj.length; i++) {
            var item = {};
            item.title = obj[i].title;
            item.text = obj[i].text;
            item.duration = obj[i].duration;
            item.weight = 0;  // TODO: the rest_api should do this
            item.tags = [];   // TODO: the rest_api should do this
            Agenda.create(item).then(
                function(success) {
                    $scope.csvimportcounter++;
                }
            );
        }
        $scope.csvimported = true;
    }

    $scope.clear = function () {
        $scope.csv.result = null;
    };

});


angular.module('OpenSlidesApp.agenda.projector', ['OpenSlidesApp.agenda'])

.config(function(slidesProvider) {
    slidesProvider.registerSlide('agenda/item', {
        template: 'static/templates/agenda/slide-item-detail.html',
    });
    slidesProvider.registerSlide('agenda/item-list', {
        template: 'static/templates/agenda/slide-item-list.html',
    });
})

.controller('SlideItemDetailCtrl', function($scope, Agenda) {
    // Attention! Each object that is used here has to be dealt on server side.
    // Add it to the coresponding get_requirements method of the ProjectorElement
    // class.
    var id = $scope.element.context.id;
    Agenda.find(id);
    Agenda.bindOne(id, $scope, 'item');
})

.controller('SlideItemListCtrl', function($scope, $http, Agenda) {
    // Attention! Each object that is used here has to be dealt on server side.
    // Add it to the coresponding get_requirements method of the ProjectorElement
    // class.
    Agenda.findAll();
    Agenda.bindAll({}, $scope, 'items');
    $scope.ids = [];
    var tree = $http.get('/rest/agenda/item/tree/').success(function(data) {
        var ids = [];
        angular.forEach(data,function(element) {
            ids.push(element.id)
        });
        $scope.ids = ids;
    })
});