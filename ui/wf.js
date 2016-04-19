(function() {
    'use strict';
    var wf = angular.module('sca-wf', [
        //'sca-shared.menu',
        //'toaster',
    ]);

    //displays task status, and if there is any dependencies, it displays that as well
    //TODO - load progress info
    //TODO - right now it only supports the end task and its dependencies. I need to support more complex dependencies
    wf.directive('scaWfTaskdeps', function($http, toaster, $interval) {
        return {
            restrict: 'E',
            //transclude: true,
            scope: {
                conf: '=', //{sca_url: , progress_url}
                taskid: '=', 
            },
            //templateUrl: (scaSharedConfig.shared_url||"../shared")+'/t/menutab.html', 
            templateUrl: 'bower_components/sca-wf/ui/t/deps.html',  //TODO - should make this configurable..
            link: function ($scope, element) {

                $scope.deps = [];

                start_loading();
                var t;
                function start_loading() {
                    console.log("start_loading");
                    load();
                    t = $interval(load, 1000);
                }
                function stop_loading() {
                    console.log("stop_loading");
                    $interval.cancel(t); 
                    t = null;
                }

                function load() {
                    console.log("loading..");
                    $http.get($scope.conf.sca_api+'/task/', {params: {
                        where: {_id: $scope.taskid},
                    }})
                    .then(function(res) {
                        $scope.task = res.data[0];
                        var status = $scope.task.status;
                        if(status == "finished" || status == "failed" || status == "stopped") {
                            stop_loading();
                        }

                        if(status == "finished") {
                            $scope.$emit('task_finished', $scope.task);
                        }
                          
                        //load all deps tasks
                        $scope.task.deps.forEach(function(dep_taskid, idx) {
                            $http.get($scope.conf.sca_api+'/task/', {params: { where: {_id: dep_taskid} }}).then(function(res) {
                                $scope.deps[idx] = res.data[0];
                            }, function(res) {
                                if(res.data && res.data.message) toaster.error(res.data.message);
                                else toaster.error(res.statusText);
                            })
                        });
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }
                $scope.$on("$destroy", function(event) {
                    console.log("destroying..");
                    stop_loading();
                });

                /*
                scope.$watch('user', function() {
                    init_menu(scope, scope.menu);
                });
                scope.go = function(url) {
                    document.location = url;
                };
                */
                $scope.stop = function() {
                    $http.put($scope.conf.sca_api+"/task/stop/"+$scope.task._id)
                    .then(function(res) {
                        toaster.success("Requested to stop this task");
                        stop_loading();
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }

                $scope.rerun = function() {
                    $http.put($scope.conf.sca_api+"/task/rerun/"+$scope.task._id)
                    .then(function(res) {
                        toaster.success("Requested to rerun this task");
                        start_loading();
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }

            }
        };
    });

})();

